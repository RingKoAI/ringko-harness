import { resolve } from "node:path";
import { instructionsText, loadInstructions, writeDiagnostic, type LoadedPlugin, type PluginLoadError, type RingkoConfig, type Skill, type SkillInstallScope } from "@ringko-ai/config";
import { registerMcpTools } from "@ringko-ai/mcp";
import { EventBus, EventLog, Scheduler, createTimeSource } from "@ringko-ai/runtime";
import { Sandbox } from "@ringko-ai/tools";
import { resolveWorkflow, workflowInstructions } from "@ringko-ai/workflow";
import { abortable, type ToolExecutionEvent, type ToolExecutionResult } from "@ringko-ai/harness";
import { createRingKo, isAccessMode, type AgentEvent, type ModelExecutionEvent, type ModelExecutionResult, type RingKo, type RingKoConfig as AgentConfig } from "./index.ts";
import { CapabilityManager, type CapabilitySnapshot } from "./capabilities.ts";
import { PermissionManager } from "./permissions.ts";
import { McpManager } from "./mcp-manager.ts";
import { ToolManager } from "./tool-manager.ts";
import { applyToolPolicy } from "./runtime-tools.ts";
import type { AgentContribution, AgentContributionContext, Disposable, RuntimeContext, RuntimeContribution, RuntimeHost } from "./runtime-contribution.ts";
export { registerRuntimeTools } from "./runtime-tools.ts";
export type { CapabilitySnapshot } from "./capabilities.ts";
export { ToolManager } from "./tool-manager.ts";
export type { AgentContribution, AgentContributionContext, Disposable, RuntimeContext, RuntimeContribution, RuntimeHost } from "./runtime-contribution.ts";
export type { PermissionRule } from "./permissions.ts";

export interface RuntimeEvents extends Record<string, unknown> {
  "run/before": { prompt: string; signal: AbortSignal };
  "run/after": { content: string };
  "run/error": { error: unknown };
  "agent/event": AgentEvent;
  "tool/pre-execute": ToolExecutionEvent;
  "tool/post-execute": ToolExecutionResult;
  "model/before-request": ModelExecutionEvent;
  "model/after-response": ModelExecutionResult;
  "skill/installed": Skill;
  "capabilities/changed": CapabilitySnapshot;
  "tool/permission": { toolName: string; target?: string; decision: "allow" | "deny" | "ask" | "default" };
}

export interface RuntimeAgent { agent: RingKo; close(): void }

/** Workspace resources outlive individual agents, models and sessions. */
export class RuntimeManager {
  readonly workspace: string;
  readonly events = new EventBus<RuntimeEvents>();
  readonly log: EventLog;
  readonly scheduler: Scheduler;
  readonly permissions: PermissionManager;
  readonly sandbox: Sandbox;
  readonly toolManager: ToolManager;
  private readonly stopTime: () => void;
  private readonly capabilityManager: CapabilityManager;
  private readonly mcp: McpManager;
  private readonly agents = new Set<() => void>();
  private readonly contributions = new Map<string, { dispose?: Disposable; handlers: Set<AgentContribution> }>();
  private readonly agentHandlers = new Set<AgentContribution>();
  private closed = false;
  private closing?: Promise<void>;

  constructor(workspace: string, log?: EventLog) {
    if (typeof workspace !== "string" || !workspace.trim()) throw new TypeError("Runtime requires a workspace.");
    this.workspace = resolve(workspace);
    this.sandbox = new Sandbox({ workspace: this.workspace });
    this.permissions = new PermissionManager(this.workspace);
    this.capabilityManager = new CapabilityManager(this.workspace);
    this.toolManager = new ToolManager(this.workspace, () => this.capabilityManager.snapshot().skills);
    this.mcp = new McpManager(this.workspace, undefined, () => {
      const snapshot = this.capabilityManager.snapshot();
      return { servers: snapshot.mcpServers, ...(snapshot.mcpError ? { error: snapshot.mcpError } : {}) };
    });
    this.log = log ?? new EventLog();
    this.scheduler = new Scheduler(this.log);
    this.stopTime = log ? () => {} : createTimeSource(this.log);
    const contribution = this.toolManager.contribution();
    const { name, handlers, context } = this.begin(contribution);
    const result = contribution.setup(context);
    if (result instanceof Promise) throw new TypeError(`Runtime contribution "${name}" must be synchronous during construction.`);
    this.contributions.set(name, { ...(typeof result === "function" ? { dispose: result } : {}), handlers });
  }

  private begin(contribution: RuntimeContribution): { name: string; handlers: Set<AgentContribution>; context: RuntimeContext } {
    if (this.closed) throw new Error("Runtime is closed.");
    const name = typeof contribution?.name === "string" ? contribution.name.trim() : "";
    if (name.length === 0) throw new TypeError("Runtime contribution requires a name.");
    if (this.contributions.has(name)) throw new Error(`Runtime contribution "${name}" is already registered.`);
    const handlers = new Set<AgentContribution>();
    return { name, handlers, context: this.context(handlers) };
  }

  /** Register a contribution and return an idempotent disposer. */
  async use(contribution: RuntimeContribution): Promise<Disposable> {
    const { name, handlers, context } = this.begin(contribution);
    let dispose: Disposable | undefined;
    try {
      const result = await contribution.setup(context);
      if (typeof result === "function") dispose = result;
    } catch (error) {
      for (const handler of handlers) this.agentHandlers.delete(handler);
      throw error;
    }
    this.contributions.set(name, { ...(dispose ? { dispose } : {}), handlers });
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      this.contributions.delete(name);
      for (const handler of handlers) this.agentHandlers.delete(handler);
      await dispose?.();
    };
  }

  private context(handlers: Set<AgentContribution>): RuntimeContext {
    return {
      workspace: this.workspace,
      events: this.events,
      log: this.log,
      scheduler: this.scheduler,
      permissions: this.permissions,
      sandbox: this.sandbox,
      mcp: {
        start: (sandbox, permissions) => this.mcp.start(sandbox, permissions),
        current: () => this.mcp.current(),
        ready: () => this.mcp.ready(),
        reset: () => this.mcp.reset(),
      },
      tools: this.toolManager,
      capabilities: () => this.capabilities(),
      skills: () => this.skills(),
      plugins: () => this.plugins(),
      installSkill: options => this.installSkill(options),
      onAgent: handler => {
        if (this.closed) throw new Error("Runtime is closed.");
        this.agentHandlers.add(handler);
        handlers.add(handler);
        return () => {
          this.agentHandlers.delete(handler);
          handlers.delete(handler);
        };
      },
    };
  }

  connections(sandbox: Sandbox = this.sandbox, permissions?: Readonly<Record<string, unknown>>): ReturnType<McpManager["start"]> {
    if (this.closed) return Promise.reject(new Error("Runtime is closed."));
    return this.mcp.start(sandbox, permissions);
  }

  /** Begin MCP connections during host startup, before the first model run. */
  start(sandbox: Sandbox = this.sandbox, permissions?: Readonly<Record<string, unknown>>): ReturnType<McpManager["start"]> { return this.mcp.start(sandbox, permissions); }

  async resetMcp(): Promise<void> {
    await this.mcp.reset();
  }

  /** Current immutable capabilities (plugins, skills, MCP servers). */
  capabilities(): CapabilitySnapshot {
    if (this.closed) throw new Error("Runtime is closed.");
    return this.capabilityManager.snapshot();
  }

  /** Rebuild the capability snapshot and notify observers. */
  reloadCapabilities(): CapabilitySnapshot {
    if (this.closed) throw new Error("Runtime is closed.");
    const snapshot = this.capabilityManager.reload();
    void this.events.parallel("capabilities/changed", snapshot).catch(error => writeDiagnostic("runtime.capabilities", String(error)));
    return snapshot;
  }

  /** Installed skills visible to this workspace, including trusted plugin skills. */
  skills(): Skill[] {
    return [...this.capabilities().skills];
  }

  /** Install a local skill directory and report the result to runtime observers. */
  async installSkill(options: { source: string; scope: SkillInstallScope }): Promise<Skill> {
    if (this.closed) throw new Error("Runtime is closed.");
    const skill = this.capabilityManager.installSkill(options);
    const snapshot = this.capabilityManager.snapshot();
    await this.events.parallel("skill/installed", skill).catch(error => writeDiagnostic("runtime.skill.installed", String(error)));
    await this.events.parallel("capabilities/changed", snapshot).catch(error => writeDiagnostic("runtime.capabilities", String(error)));
    return skill;
  }

  /** Trusted plugins and manifest errors for this workspace. */
  plugins(): { plugins: LoadedPlugin[]; errors: PluginLoadError[] } {
    const snapshot = this.capabilities();
    return { plugins: [...snapshot.plugins], errors: [...snapshot.pluginErrors] };
  }

  /** Snapshot connected MCP servers for discovery/status without starting them. */
  currentConnections(): ReturnType<McpManager["current"]> {
    return this.mcp.current();
  }

  /** Await the startup connection pass, then snapshot discovery. */
  readyConnections(): ReturnType<McpManager["ready"]> {
    return this.mcp.ready();
  }

  /** Build a tool-only agent for capability discovery without starting MCP. */
  previewTools(config: RingkoConfig, host: RuntimeHost = {}): { agent: RingKo; sandbox: Sandbox } {
    if (this.closed) throw new Error("Runtime is closed.");
    const agent = createRingKo({ task: true, model: async () => ({ content: "", toolCalls: [] }) });
    for (const handler of this.agentHandlers) handler(agent, config, { host });
    return { agent, sandbox: this.toolManager.sandboxFor(agent) ?? this.sandbox };
  }

  createAgent(config: RingkoConfig, options: AgentConfig, host: RuntimeHost = {}): RuntimeAgent {
    if (this.closed) throw new Error("Runtime is closed.");
    if (config.permission !== undefined && !isAccessMode(config.permission)) throw new TypeError("Invalid runtime permission mode.");
    if (config.maxTurns !== undefined && (!Number.isInteger(config.maxTurns) || config.maxTurns < 1)) throw new TypeError("Invalid maxTurns; expected a positive integer.");
    const workflow = resolveWorkflow(config.workflow);
    for (const names of [workflow.tools?.allow, workflow.tools?.deny]) {
      if (names !== undefined && (!Array.isArray(names) || names.some(name => typeof name !== "string" || !name))) throw new TypeError("Workflow tool policy must contain tool names.");
    }
    const permission = config.permission ?? config.mode;
    const controller = new AbortController();
    const permissionSession = options.session?.id ?? crypto.randomUUID();
    let running = false;
    let mcpToolNames: string[] = [];
    const reportedErrors = new Map<string, string>();
    let workflowModel: Promise<Awaited<ReturnType<NonNullable<AgentConfig["resolveTaskModel"]>>>> | undefined;
    const agent = createRingKo({
      ...options, log: this.log, scheduler: this.scheduler,
      resolveInstructions: async () => [
        instructionsText(loadInstructions({ cwd: this.workspace })),
        workflowInstructions(workflow),
        options.resolveInstructions ? await options.resolveInstructions() : undefined,
      ].filter(Boolean).join("\n\n"),
      requestApproval: this.permissions.approval(permissionSession, options.requestApproval),
      model: workflow.model ? async request => {
        if (!options.resolveTaskModel || !options.taskModels?.includes(workflow.model!)) throw new Error(`Workflow model "${workflow.model}" is not available in this host.`);
        workflowModel ??= options.resolveTaskModel(workflow.model!);
        return await (await workflowModel)(request);
      } : options.model,
      modelId: workflow.model ?? options.modelId,
      compaction: options.compaction ?? config.compaction,
      ...((options.maxTurns ?? config.maxTurns) !== undefined ? { maxTurns: options.maxTurns ?? config.maxTurns } : {}),
      ...(isAccessMode(permission) ? { accessMode: permission } : {}),
      onEvent: event => {
        this.log.append("session", { type: event.type, turn: event.turn, toolName: event.toolName ?? null });
        void this.events.parallel("agent/event", event).catch(error => writeDiagnostic("runtime.event", String(error)));
        options.onEvent?.(event);
      },
      onToolBefore: async event => {
        await this.events.serial("tool/pre-execute", event);
      },
      onToolAfter: async event => {
        await this.events.parallel("tool/post-execute", event).catch(error => writeDiagnostic("runtime.tool.post", String(error)));
      },
      onModelBefore: async event => {
        await this.events.serial("model/before-request", event);
      },
      onModelAfter: async event => {
        await this.events.parallel("model/after-response", event).catch(error => writeDiagnostic("runtime.model.post", String(error)));
      },
    });
    const agentDisposers: Disposable[] = [];
    const agentContext: AgentContributionContext = { host, ...(options.session ? { session: options.session } : {}) };
    try {
      for (const handler of this.agentHandlers) {
        const dispose = handler(agent, config, agentContext);
        if (typeof dispose === "function") agentDisposers.push(dispose);
      }
    } catch (error) {
      controller.abort();
      throw error;
    }
    const toolSandbox = this.toolManager.sandboxFor(agent) ?? this.sandbox;
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
        const opened = await abortable(this.connections(toolSandbox, config.sandbox?.mcp), signal);
        signal.throwIfAborted();
        for (const name of mcpToolNames) agent.tools.unregister(name);
        mcpToolNames = registerMcpTools(agent.tools, opened.connections, { mode: config.sandbox?.mode ?? "workspace-write", permissions: config.sandbox?.mcp });
        for (const error of opened.errors) {
          if (reportedErrors.get(error.name) !== error.message) {
            host.report?.(`MCP ${error.name}: connection failed: ${error.message}`);
            reportedErrors.set(error.name, error.message);
          }
        }
        for (const name of reportedErrors.keys()) if (!opened.errors.some(error => error.name === name)) reportedErrors.delete(name);
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
      for (const dispose of agentDisposers.reverse()) {
        try {
          const pending = dispose();
          if (pending) void Promise.resolve(pending).catch(error => writeDiagnostic("runtime.contribution", String(error)));
        } catch (error) {
          writeDiagnostic("runtime.contribution", String(error));
        }
      }
      controller.abort();
      agent.jobs.cancelAll();
      this.agents.delete(close);
    };
    this.agents.add(close);
    return { agent, close };
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.stopTime();
    for (const task of this.scheduler.list()) this.scheduler.remove(task.id);
    for (const close of [...this.agents]) close();
    this.permissions.clearSessions();
    this.closing = (async () => {
      const contributions = [...this.contributions.values()].reverse();
      this.contributions.clear();
      for (const contribution of contributions) {
        for (const handler of contribution.handlers) this.agentHandlers.delete(handler);
        try { await contribution.dispose?.(); }
        catch (error) { writeDiagnostic("runtime.contribution", String(error)); }
      }
      this.capabilityManager.close();
      await this.mcp.close();
    })();
    return this.closing;
  }
}

