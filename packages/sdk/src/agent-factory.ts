// Agent construction and per-run MCP/hook wiring.
//
// RuntimeManager owns lifecycle; AgentFactory turns a capability snapshot and
// host options into a RingKo agent. It never discovers plugins or reads config.

import { instructionsText, loadInstructions, writeDiagnostic, type RingkoConfig } from "@ringko-ai/config";
import { abortable } from "@ringko-ai/harness";
import { registerMcpTools } from "@ringko-ai/mcp";
import type { EventBus, EventLog, Scheduler } from "@ringko-ai/runtime";
import type { Sandbox } from "@ringko-ai/tools";
import { resolveWorkflow, workflowInstructions } from "@ringko-ai/workflow";
import { createRingKo, isAccessMode, type RingKo, type RingKoConfig as AgentConfig } from "./index.ts";
import type { McpManager } from "./mcp-manager.ts";
import type { PermissionManager } from "./permissions.ts";
import type { Disposable, RuntimeHost } from "./runtime-contribution.ts";
import type { RuntimeEvents } from "./runtime-events.ts";
import { applyToolPolicy } from "./runtime-tools.ts";
import type { ExtensionRegistry } from "./extension-registry.ts";
import type { ToolManager } from "./tool-manager.ts";

export interface RuntimeAgent { agent: RingKo; close(): Promise<void> }

async function disposeReverse(disposers: readonly Disposable[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const dispose of [...disposers].reverse()) {
    try {
      const pending = dispose();
      if (pending) await pending;
    } catch (error) { errors.push(error); }
  }
  return errors;
}

export interface AgentFactoryDeps {
  workspace: string;
  events: EventBus<RuntimeEvents>;
  log: EventLog;
  scheduler: Scheduler;
  sandbox: Sandbox;
  permissions: PermissionManager;
  toolManager: ToolManager;
  extensions: ExtensionRegistry;
  startMcp(sandbox: Sandbox, permissions?: Readonly<Record<string, unknown>>): ReturnType<McpManager["start"]>;
}

export class AgentFactory {
  private readonly agents = new Set<() => Promise<void>>();
  private closed = false;

  constructor(private readonly deps: AgentFactoryDeps) {}

  /** Build a tool-only agent for capability discovery without starting MCP. */
  preview(config: RingkoConfig, host: RuntimeHost = {}): { agent: RingKo; sandbox: Sandbox; close(): Promise<void> } {
    if (this.closed) throw new Error("Agent factory is closed.");
    const agent = createRingKo({ task: true, model: async () => ({ content: "", toolCalls: [] }) });
    const disposers = this.deps.extensions.apply(agent, config, { host });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      closing = (async () => {
        const errors: unknown[] = [];
        try { agent.jobs.cancelAll(); } catch (error) { errors.push(error); }
        try { await agent.jobs.settle(); } catch (error) { errors.push(error); }
        errors.push(...await disposeReverse(disposers));
        try { await agent.subagents?.close(); } catch (error) { errors.push(error); }
        if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Preview agent close failed.");
      })();
      return closing;
    };
    return { agent, sandbox: this.deps.toolManager.sandboxFor(agent) ?? this.deps.sandbox, close };
  }

  create(config: RingkoConfig, options: AgentConfig, host: RuntimeHost = {}): RuntimeAgent {
    if (this.closed) throw new Error("Agent factory is closed.");
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
      ...options, log: this.deps.log, scheduler: this.deps.scheduler,
      resolveInstructions: async () => [
        instructionsText(loadInstructions({ cwd: this.deps.workspace })),
        workflowInstructions(workflow),
        options.resolveInstructions ? await options.resolveInstructions() : undefined,
      ].filter(Boolean).join("\n\n"),
      requestApproval: this.deps.permissions.approval(permissionSession, options.requestApproval),
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
        this.deps.log.append("session", { type: event.type, turn: event.turn, toolName: event.toolName ?? null });
        void this.deps.events.parallel("agent/event", event).catch(error => writeDiagnostic("runtime.event", String(error)));
        options.onEvent?.(event);
      },
      onToolBefore: async event => {
        await options.onToolBefore?.(event);
        await this.deps.events.serial("tool/pre-execute", event);
      },
      onToolAfter: async event => {
        await this.deps.events.parallel("tool/post-execute", event).catch(error => writeDiagnostic("runtime.tool.post", String(error)));
        await options.onToolAfter?.(event);
      },
      onModelBefore: async event => {
        await options.onModelBefore?.(event);
        await this.deps.events.serial("model/before-request", event);
      },
      onModelAfter: async event => {
        await this.deps.events.parallel("model/after-response", event).catch(error => writeDiagnostic("runtime.model.post", String(error)));
        await options.onModelAfter?.(event);
      },
      onRunBefore: async (prompt, runSignal) => {
        const signal = runSignal ?? controller.signal;
        const opened = await abortable(this.deps.startMcp(toolSandbox, config.sandbox?.mcp), signal);
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
        await abortable(Promise.resolve(options.onRunBefore?.(prompt, signal)), signal);
        await abortable(this.deps.events.serial("run/before", { prompt, signal }), signal);
        applyToolPolicy(agent, workflow);
      },
      onRunAfter: async (result, runSignal) => {
        const signal = runSignal ?? controller.signal;
        await abortable(this.deps.events.serial("run/after", { content: result.content }), signal);
        await abortable(Promise.resolve(options.onRunAfter?.(result, signal)), signal);
      },
    });
    const agentContext = { host, ...(options.session ? { session: options.session } : {}) };
    let agentDisposers: Disposable[];
    try {
      agentDisposers = this.deps.extensions.apply(agent, config, agentContext);
    } catch (error) {
      controller.abort();
      throw error;
    }
    const toolSandbox = this.deps.toolManager.sandboxFor(agent) ?? this.deps.sandbox;
    agent.tools.setPermissionCheck(async request => {
      const rule = this.deps.permissions.decide(permissionSession, request.toolName, request.target, request.alternates);
      const decision = rule === "deny" || rule === "ask" ? rule : (await abortable(this.deps.events.waterfall("tool/permission", { toolName: request.toolName, target: request.target, decision: rule }), request.signal)).decision;
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
        return await run(prompt, { signal });
      } catch (error) {
        await this.deps.events.parallel("run/error", { error }).catch(hookError => writeDiagnostic("runtime.hook", String(hookError)));
        throw error;
      } finally { running = false; }
    };
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      closing = (async () => {
        const errors: unknown[] = [];
        try { controller.abort(); } catch (error) { errors.push(error); }
        try { agent.jobs.cancelAll(); } catch (error) { errors.push(error); }
        try { await agent.jobs.settle(); } catch (error) { errors.push(error); }
        errors.push(...await disposeReverse(agentDisposers));
        try { await agent.subagents?.close(); } catch (error) { errors.push(error); }
        this.agents.delete(close);
        if (errors.length > 0) {
          for (const error of errors) writeDiagnostic("runtime.agent.close", String(error));
          throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Agent close failed.");
        }
      })();
      return closing;
    };
    this.agents.add(close);
    return { agent, close };
  }

  /** Close every agent created by this factory and report every failure. */
  async closeAll(): Promise<void> {
    this.closed = true;
    const results = await Promise.allSettled([...this.agents].map(close => close()));
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Agent factory close failed.");
  }
}
