import { resolve } from "node:path";
import { instructionsText, loadInstructions, loadMcpServers, writeDiagnostic, type RingkoConfig } from "@ringko-ai/config";
import { closeMcpConnections, openMcpServers, registerMcpTools } from "@ringko-ai/mcp";
import { EventBus, EventLog, Scheduler, createTimeSource } from "@ringko-ai/runtime";
import { sessionTodos } from "@ringko-ai/session";
import { createTodoStore, registerNetworkTools, registerSessionTools, registerShellTools, registerWorkspaceTools, type AskHandler, type TodoItem } from "@ringko-ai/tools";
import { resolveWorkflow, workflowAllowsTool, workflowInstructions, type Workflow } from "@ringko-ai/workflow";
import { abortable } from "@ringko-ai/harness";
import { createRingKo, isAccessMode, type AgentEvent, type RingKo, type RingKoConfig as AgentConfig } from "./index.ts";
import { registerRuntimeSkills } from "./skills.ts";
import { PermissionManager } from "./permissions.ts";
export type { PermissionRule } from "./permissions.ts";

export interface RuntimeHost {
  ask?: AskHandler;
  onTodo?: (todos: TodoItem[]) => void;
  report?: (message: string) => void;
}

export interface RuntimeEvents extends Record<string, unknown> {
  "run/before": { prompt: string; signal: AbortSignal };
  "run/after": { content: string };
  "run/error": { error: unknown };
  "agent/event": AgentEvent;
  "tool/permission": { toolName: string; target?: string; decision: "allow" | "deny" | "ask" | "default" };
}

function applyToolPolicy(agent: RingKo, workflow: Workflow): void {
  for (const tool of agent.tools.list()) if (!workflowAllowsTool(workflow, tool.name)) agent.tools.unregister(tool.name);
}

/** Shared tool assembly for executing agents and capability previews. */
export function registerRuntimeTools(agent: RingKo, config: RingkoConfig, workspace: string, host: RuntimeHost = {}, session?: AgentConfig["session"]): void {
  registerWorkspaceTools(agent.tools, { workspace });
  const todos = createTodoStore(items => {
    if (session) { session.appendEvent("session/todo", { todos: items }); session.flush(); }
    host.onTodo?.(items);
  });
  todos.todos = session ? sessionTodos(session.all()) : [];
  registerSessionTools(agent.tools, { todos, ask: host.ask ?? (async () => { throw new Error("Questions require an interactive host."); }) });
  if (config.capabilities?.network) registerNetworkTools(agent.tools);
  if (config.capabilities?.shell) registerShellTools(agent.tools, { cwd: workspace });
  registerRuntimeSkills(agent.tools, workspace);
  applyToolPolicy(agent, resolveWorkflow(config.workflow));
}

export interface RuntimeAgent { agent: RingKo; close(): void }

/** Workspace resources outlive individual agents, models and sessions. */
export class RuntimeManager {
  readonly workspace: string;
  readonly events = new EventBus<RuntimeEvents>();
  readonly log: EventLog;
  readonly scheduler: Scheduler;
  readonly permissions: PermissionManager;
  private readonly stopTime: () => void;
  private mcp?: Promise<Awaited<ReturnType<typeof openMcpServers>>>;
  private readonly agents = new Set<() => void>();
  private closed = false;
  private closing?: Promise<void>;

  constructor(workspace: string, log?: EventLog) {
    if (typeof workspace !== "string" || !workspace.trim()) throw new TypeError("Runtime requires a workspace.");
    this.workspace = resolve(workspace);
    this.permissions = new PermissionManager(this.workspace);
    this.log = log ?? new EventLog();
    this.scheduler = new Scheduler(this.log);
    this.stopTime = log ? () => {} : createTimeSource(this.log);
  }

  connections(): Promise<Awaited<ReturnType<typeof openMcpServers>>> {
    if (this.closed) return Promise.reject(new Error("Runtime is closed."));
    return this.mcp ??= (async () => {
      try {
        const servers = loadMcpServers({ cwd: this.workspace });
        return await openMcpServers(Object.fromEntries(servers.map(server => [server.name, server.config])));
      } catch (error) {
        return { connections: [], errors: [{ name: "configuration", message: error instanceof Error ? error.message : String(error) }] };
      }
    })();
  }

  async resetMcp(): Promise<void> {
    const old = this.mcp;
    this.mcp = undefined;
    if (old) await closeMcpConnections((await old).connections);
  }

  createAgent(config: RingkoConfig, options: AgentConfig, host: RuntimeHost = {}): RuntimeAgent {
    if (this.closed) throw new Error("Runtime is closed.");
    if (config.permission !== undefined && !isAccessMode(config.permission)) throw new TypeError("Invalid runtime permission mode.");
    const workflow = resolveWorkflow(config.workflow);
    for (const names of [workflow.tools?.allow, workflow.tools?.deny]) {
      if (names !== undefined && (!Array.isArray(names) || names.some(name => typeof name !== "string" || !name))) throw new TypeError("Workflow tool policy must contain tool names.");
    }
    const instructions = [instructionsText(loadInstructions({ cwd: this.workspace })), workflowInstructions(workflow), options.instructions].filter(Boolean).join("\n\n");
    const runtimeInstructions = `[Runtime instructions]\n${instructions}`;
    const history = (options.history ?? []).filter(message => !(message.role === "system" && message.content.startsWith("[Runtime instructions]\n")));
    const permission = config.permission ?? config.mode;
    const controller = new AbortController();
    const permissionSession = options.session?.id ?? crypto.randomUUID();
    let running = false;
    let mcpToolNames: string[] = [];
    let workflowModel: Promise<Awaited<ReturnType<NonNullable<AgentConfig["resolveTaskModel"]>>>> | undefined;
    const agent = createRingKo({
      ...options, log: this.log, scheduler: this.scheduler, instructions,
      requestApproval: this.permissions.approval(permissionSession, options.requestApproval),
      history: instructions ? [{ role: "system", content: runtimeInstructions }, ...history] : history,
      model: workflow.model ? async request => {
        if (!options.resolveTaskModel || !options.taskModels?.includes(workflow.model!)) throw new Error(`Workflow model "${workflow.model}" is not available in this host.`);
        workflowModel ??= options.resolveTaskModel(workflow.model!);
        return await (await workflowModel)(request);
      } : options.model,
      modelId: workflow.model ?? options.modelId,
      compaction: options.compaction ?? config.compaction,
      ...(isAccessMode(permission) ? { accessMode: permission } : {}),
      onEvent: event => {
        this.log.append("session", { type: event.type, turn: event.turn, toolName: event.toolName ?? null });
        void this.events.parallel("agent/event", event).catch(error => writeDiagnostic("runtime.event", String(error)));
        options.onEvent?.(event);
      },
    });
    registerRuntimeTools(agent, config, this.workspace, host, options.session);
    agent.tools.setPermissionCheck(async request => {
      const rule = this.permissions.decide(permissionSession, request.toolName, request.target);
      const decision = rule === "deny" || rule === "ask" ? rule : (await abortable(this.events.waterfall("tool/permission", { toolName: request.toolName, target: request.target, decision: rule }), request.signal)).decision;
      writeDiagnostic("permission.decision", JSON.stringify({ tool: request.toolName, decision }));
      return decision;
    });
    const run = agent.run.bind(agent);
    agent.run = async (prompt, runOptions) => {
      if (running) throw new Error("Agent is already running.");
      const signal = runOptions?.signal ? AbortSignal.any([controller.signal, runOptions.signal]) : controller.signal;
      signal.throwIfAborted();
      running = true;
      try {
        const opened = await abortable(this.connections(), signal);
        signal.throwIfAborted();
        for (const name of mcpToolNames) agent.tools.unregister(name);
        mcpToolNames = registerMcpTools(agent.tools, opened.connections);
        for (const error of opened.errors) {
          writeDiagnostic(`mcp.${error.name}`, error.message);
          host.report?.(`MCP ${error.name}: connection failed: ${error.message}`);
        }
        applyToolPolicy(agent, workflow);
        await abortable(this.events.serial("run/before", { prompt, signal }), signal);
        applyToolPolicy(agent, workflow);
        const result = await run(prompt, { signal });
        await abortable(this.events.serial("run/after", { content: result.content }), signal);
        return result;
      } catch (error) {
        await this.events.parallel("run/error", { error }).catch(hookError => writeDiagnostic("runtime.hook", String(hookError)));
        throw error;
      } finally { running = false; }
    };
    const close = (): void => {
      controller.abort();
      agent.jobs.cancelAll();
      this.agents.delete(close);
    };
    this.agents.add(close);
    return { agent, close };
  }

  close(): Promise<void> {
    this.closed = true;
    this.stopTime();
    for (const task of this.scheduler.list()) this.scheduler.remove(task.id);
    for (const close of [...this.agents]) close();
    this.permissions.clearSessions();
    return this.closing ??= this.resetMcp();
  }
}
