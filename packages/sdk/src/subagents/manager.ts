import { isAbsolute, relative, resolve, sep } from "node:path";
import { writeDiagnostic } from "@ringko-ai/config";
import {
  defineTool,
  type JobSnapshot,
  type ToolDefinition,
} from "@ringko-ai/harness";
import type { SessionHandle } from "@ringko-ai/session";
import { recentCatalog, subagentCatalog } from "./catalog.ts";
import { SubagentProviderRegistry } from "./registry.ts";
import {
  SUBAGENT_LIMITS,
  type SubagentCatalogEntry,
  type SubagentEvent,
  type SubagentLimits,
  type SubagentMode,
  type SubagentProvider,
  type SubagentProviderContext,
  type SubagentResult,
  type SubagentRunHandle,
  type SubagentStartInput,
  type SubagentTaskEvent,
  type SubagentTaskResult,
} from "./types.ts";

export interface SubagentManagerOptions {
  workspace: string;
  providers: readonly SubagentProvider[];
  context: Omit<SubagentProviderContext, "onEvent" | "signal" | "parentCallId">;
  session?: SessionHandle;
  defaultProvider?: string;
  limits?: Partial<SubagentLimits>;
  onTaskEvent?: (event: SubagentTaskEvent) => void;
  onSubagentEvent?: (event: SubagentEvent) => void;
}

interface LiveChild {
  handle: SubagentRunHandle;
  entry: SubagentCatalogEntry;
  running: boolean;
}

export interface ManagedSubagent {
  entry: SubagentCatalogEntry;
  result: Promise<SubagentResult>;
  send(content: string, signal?: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}

const MODES = new Set<SubagentMode>(["read", "write", "full"]);

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function parseTask(value: unknown): SubagentStartInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a subagent task.");
  const data = value as Record<string, unknown>;
  const allowed = ["description", "prompt", "mode", "provider", "model", "background", "cwd"];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new TypeError("Unexpected task field.");
  if (typeof data.description !== "string" || !data.description.trim() || data.description.length > SUBAGENT_LIMITS.descriptionCharacters) {
    throw new TypeError(`Task description must contain 1–${SUBAGENT_LIMITS.descriptionCharacters} characters.`);
  }
  if (typeof data.prompt !== "string" || !data.prompt.trim() || data.prompt.length > SUBAGENT_LIMITS.promptCharacters) {
    throw new TypeError(`Task prompt must contain 1–${SUBAGENT_LIMITS.promptCharacters} characters.`);
  }
  if (!MODES.has(data.mode as SubagentMode)) throw new TypeError("Task mode must be read, write or full.");
  if (data.provider !== undefined && (typeof data.provider !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(data.provider))) throw new TypeError("Invalid task provider.");
  if (data.model !== undefined && (typeof data.model !== "string" || !data.model || data.model.length > 256)) throw new TypeError("Invalid task model.");
  if (data.cwd !== undefined && (typeof data.cwd !== "string" || !data.cwd || data.cwd.length > 8192 || data.cwd.includes("\0"))) throw new TypeError("Invalid task working directory.");
  if (data.background !== undefined && typeof data.background !== "boolean") throw new TypeError("background must be boolean.");
  return {
    description: data.description.trim(),
    prompt: data.prompt,
    mode: data.mode as SubagentMode,
    ...(typeof data.provider === "string" ? { provider: data.provider } : {}),
    ...(typeof data.model === "string" ? { model: data.model } : {}),
    ...(typeof data.cwd === "string" ? { cwd: data.cwd } : {}),
    ...(typeof data.background === "boolean" ? { background: data.background } : {}),
  };
}

function parseControl(value: unknown): { action: "list" | "status" | "send" | "interrupt"; taskId?: string; prompt?: string; background?: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a subagent control request.");
  const data = value as Record<string, unknown>;
  const allowed = ["action", "taskId", "prompt", "background"];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new TypeError("Unexpected control field.");
  if (!["list", "status", "send", "interrupt"].includes(String(data.action))) throw new TypeError("Invalid control action.");
  if (data.taskId !== undefined && (typeof data.taskId !== "string" || data.taskId.length === 0 || data.taskId.length > 128)) throw new TypeError("Invalid task id.");
  if (data.prompt !== undefined && (typeof data.prompt !== "string" || data.prompt.length === 0 || data.prompt.length > SUBAGENT_LIMITS.promptCharacters)) throw new TypeError("Invalid follow-up prompt.");
  if (data.background !== undefined && typeof data.background !== "boolean") throw new TypeError("background must be boolean.");
  return {
    action: data.action as "list" | "status" | "send" | "interrupt",
    ...(typeof data.taskId === "string" ? { taskId: data.taskId } : {}),
    ...(typeof data.prompt === "string" ? { prompt: data.prompt } : {}),
    ...(typeof data.background === "boolean" ? { background: data.background } : {}),
  };
}

/**
 * One parent-owned subagent catalog over named providers. The manager owns
 * admission, events, background correlation and the parent session log; a
 * provider only owns the child execution itself.
 */
export class SubagentManager {
  private readonly registry = new SubagentProviderRegistry();
  private readonly limits: SubagentLimits;
  private readonly live = new Map<string, LiveChild>();
  private readonly defaultProvider: string;
  private active = 0;
  private launched = 0;

  constructor(private readonly options: SubagentManagerOptions) {
    this.limits = { ...SUBAGENT_LIMITS, ...options.limits };
    for (const provider of options.providers) this.registry.register(provider);
    const first = options.defaultProvider ?? options.providers[0]?.name;
    if (!first) throw new TypeError("A subagent manager needs at least one provider.");
    this.defaultProvider = first;
    if (!this.registry.has(first)) throw new TypeError(`Unknown default subagent provider "${first}".`);
  }

  descriptors() { return this.registry.descriptors(); }
  resetRun(): void {
    if ([...this.live.values()].some(child => child.running)) throw new Error("Cannot reset subagent budget while children are running.");
    this.launched = 0;
    for (const child of this.live.values()) {
      void child.handle.dispose().catch(error => writeDiagnostic("subagent.reset", String(error)));
    }
    this.live.clear();
  }

  async start(input: SubagentStartInput, overrides: { signal?: AbortSignal; jobs?: SubagentProviderContext["jobs"]; parentCallId?: string; jobEmit?: (type: string, data: unknown) => void } = {}): Promise<ManagedSubagent> {
    const providerName = input.provider ?? this.defaultProvider;
    const provider = this.registry.get(providerName);
    if (!provider) throw new Error(`Unknown subagent provider "${providerName}".`);
    if (provider.available && !(await provider.available())) throw new Error(`Subagent provider "${providerName}" is unavailable.`);
    if (input.model) {
      if (!provider.capabilities.modelSelection) throw new Error(`Subagent provider "${providerName}" does not accept a model.`);
      const allowed = provider.modelIds ?? this.options.context.models;
      if (!allowed?.includes(input.model)) throw new TypeError("Task model is not configured by this host.");
      if (!provider.modelIds && !this.options.context.resolveModel) throw new TypeError("Task model is not configured by this host.");
    }
    const base = this.options.context;
    if (this.active >= this.limits.maxActive) throw new Error("Subagent concurrency limit reached.");
    if (this.launched >= this.limits.maxPerRun) throw new Error("Subagent budget exhausted for this run.");
    this.active += 1;
    this.launched += 1;
    const cwd = resolve(this.options.workspace, input.cwd ?? ".");
    const modelId = input.model ?? base.modelId ?? "current";
    const context: SubagentProviderContext = {
      ...base,
      workspace: this.options.workspace,
      ...(overrides.signal ? { signal: overrides.signal } : {}),
      ...(overrides.jobs ? { jobs: overrides.jobs } : {}),
      ...(overrides.parentCallId ? { parentCallId: overrides.parentCallId } : {}),
      onEvent: event => this.forward(event, overrides.jobEmit),
    };
    let handle: SubagentRunHandle;
    try {
      handle = await provider.start({ ...input, cwd }, context);
    } catch (error) {
      this.active -= 1;
      throw error;
    }
    const entry: SubagentCatalogEntry = {
      childId: handle.childId,
      provider: providerName,
      description: input.description,
      mode: input.mode,
      ...(input.model ? { model: input.model } : {}),
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      parentCallId: overrides.parentCallId ?? null,
      resumable: handle.capabilities.resume,
      ...(handle.sessionId ? { sessionId: handle.sessionId } : {}),
      cwd,
    };
    const child: LiveChild = { handle, entry, running: true };
    this.live.set(handle.childId, child);
    this.append("task/started", {
      taskId: handle.childId,
      parentCallId: entry.parentCallId,
      description: entry.description,
      mode: entry.mode,
      model: modelId,
      provider: providerName,
      cwd,
      resumable: entry.resumable,
      ...(handle.sessionId ? { sessionId: handle.sessionId } : {}),
    });
    this.emitTask({ ...this.baseEvent(entry, modelId), type: "started", time: Date.now() });
    const result = handle.result.then(
      settled => this.finish(child, settled, modelId),
      error => this.finish(child, this.providerFailure(handle, error), modelId),
    );
    return {
      entry,
      result,
      send: async (content, signal) => {
        if (!handle.send) throw new Error(`Subagent provider "${providerName}" does not accept follow-up messages.`);
        child.running = true;
        try { await handle.send(content, signal); }
        finally { child.running = false; }
      },
      dispose: async () => {
        await handle.dispose();
        if (this.live.get(handle.childId) === child) this.live.delete(handle.childId);
      },
    };
  }

  /** Send a follow-up to a live child, cold-resuming a persisted child when necessary. */
  async send(childId: string, content: string, overrides: { signal?: AbortSignal; jobs?: SubagentProviderContext["jobs"]; parentCallId?: string } = {}): Promise<void> {
    if (typeof content !== "string" || content.trim().length === 0 || content.length > this.limits.promptCharacters) {
      throw new TypeError("Follow-up prompt must contain 1–16384 characters.");
    }
    const live = this.live.get(childId);
    if (live?.handle.send) {
      live.running = true;
      try { await live.handle.send(content, overrides.signal); }
      finally { live.running = false; }
      return;
    }
    const entry = this.listChildren().find(item => item.childId === childId);
    if (!entry) throw new Error(`Unknown subagent "${childId}".`);
    const provider = this.registry.get(entry.provider);
    if (!provider?.resume || !entry.resumable) throw new Error(`Subagent "${childId}" cannot be resumed.`);
    const base = this.options.context;
    const context: SubagentProviderContext = {
      ...base,
      workspace: this.options.workspace,
      ...(overrides.signal ? { signal: overrides.signal } : {}),
      ...(overrides.jobs ? { jobs: overrides.jobs } : {}),
      ...(overrides.parentCallId ? { parentCallId: overrides.parentCallId } : {}),
      onEvent: event => this.forward(event),
    };
    const handle = await provider.resume(entry, context);
    if (!handle.send) throw new Error(`Subagent provider "${entry.provider}" does not accept follow-up messages.`);
    const child: LiveChild = { handle, entry: { ...entry, status: "running", completedAt: null }, running: true };
    this.live.set(childId, child);
    this.append("task/status", { taskId: childId, status: "running" });
    try { await handle.send(content, overrides.signal); }
    finally { child.running = false; }
  }

  interrupt(childId: string): void {
    const child = this.live.get(childId);
    if (!child) throw new Error(`Subagent "${childId}" is not running.`);
    child.handle.interrupt?.();
  }

  /** Durable parent-owned catalog; live entries overlay persisted state. */
  listChildren(limit = 50): SubagentCatalogEntry[] {
    const events = this.options.session?.all() ?? [];
    const running = [...this.live.values()].some(child => child.running);
    const entries = new Map(subagentCatalog(events, running).map(entry => [entry.childId, entry]));
    for (const child of this.live.values()) {
      entries.set(child.entry.childId, { ...child.entry, status: child.running ? "running" : child.entry.status });
    }
    return recentCatalog([...entries.values()], limit);
  }

  /** Release live children and their sessions without unregistering providers. */
  async release(): Promise<void> {
    const children = [...this.live.entries()];
    const results = await Promise.allSettled(children.map(async ([, child]) => { await child.handle.dispose(); }));
    for (const [id, child] of children) if (this.live.get(id) === child) this.live.delete(id);
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Subagent release failed.");
  }

  async close(): Promise<void> {
    try { await this.release(); }
    finally { this.registry.close(); }
  }

  private finish(child: LiveChild, result: SubagentResult, modelId: string): SubagentResult {
    child.running = false;
    child.entry.status = result.status;
    child.entry.completedAt = Date.now();
    if (result.content) child.entry.content = result.content;
    if (result.status !== "completed") child.entry.reason = result.stopReason;
    if (result.metadata) child.entry.metadata = { ...child.entry.metadata, ...result.metadata };
    this.active = Math.max(0, this.active - 1);
    const type = result.status === "completed" ? "task/completed" : result.status === "cancelled" ? "task/cancelled" : "task/failed";
    this.append(type, {
      taskId: result.childId,
      parentCallId: child.entry.parentCallId,
      description: child.entry.description,
      mode: child.entry.mode,
      model: child.entry.model ?? modelId,
      provider: result.provider,
      result,
      ...(result.status !== "completed" ? { reason: result.stopReason } : {}),
    });
    this.emitTask({
      ...this.baseEvent(child.entry, modelId),
      type: result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed",
      time: Date.now(),
      result,
      ...(result.status !== "completed" ? { reason: result.stopReason } : {}),
    });
    this.options.onSubagentEvent?.({
      childId: result.childId,
      provider: result.provider,
      type: result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed",
      time: Date.now(),
      result,
    });
    return result;
  }

  private providerFailure(handle: SubagentRunHandle, error: unknown): SubagentResult {
    return {
      childId: handle.childId,
      provider: handle.provider,
      status: "failed",
      content: "",
      stopReason: "error",
      diagnostic: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
  }

  private baseEvent(entry: SubagentCatalogEntry, modelId: string): Omit<SubagentTaskEvent, "type" | "time"> {
    return {
      taskId: entry.childId,
      parentCallId: entry.parentCallId,
      description: entry.description,
      mode: entry.mode,
      model: entry.model ?? modelId,
      provider: entry.provider,
    };
  }

  private forward(event: SubagentEvent, jobEmit?: (type: string, data: unknown) => void): void {
    const live = this.live.get(event.childId);
    if (live) {
      if (event.type === "status" && event.status) {
        live.running = event.status === "running";
        live.entry.status = event.status;
        if (event.status === "running") live.entry.completedAt = null;
        else live.entry.completedAt = event.time;
        if (event.result) {
          if (event.result.content) live.entry.content = event.result.content;
          if (event.result.metadata) live.entry.metadata = { ...live.entry.metadata, ...event.result.metadata };
          if (event.result.status !== "completed") live.entry.reason = event.result.stopReason;
        }
      }
      if (event.message?.role === "assistant") live.entry.content = event.message.content;
      if (event.metadata) live.entry.metadata = { ...live.entry.metadata, ...event.metadata };
    }
    if (event.metadata) this.append("task/provider", { taskId: event.childId, metadata: event.metadata });
    if (event.type === "agent") {
      this.append("task/event", { taskId: event.childId, event: event.agentEvent });
    } else if (event.type === "message" && event.message) {
      this.append("task/message", { taskId: event.childId, role: event.message.role, content: event.message.content });
    } else if (event.type === "status" && event.status) {
      this.append("task/status", { taskId: event.childId, status: event.status, ...(event.result ? { result: event.result } : {}) });
    }
    this.options.onSubagentEvent?.(event);
    // The historical task event stream carries child model/tool activity.
    // Message/status frames remain in the session log and the subagent stream
    // so existing onTaskEvent consumers keep their contract.
    if (event.type !== "agent") return;
    const entry = live?.entry;
    const mapped: SubagentTaskEvent = {
      taskId: event.childId,
      parentCallId: entry?.parentCallId ?? null,
      description: entry?.description ?? "",
      mode: entry?.mode ?? "read",
      model: entry?.model ?? this.options.context.modelId ?? "current",
      provider: event.provider,
      type: "event",
      time: event.time,
      ...(event.agentEvent ? { event: event.agentEvent } : {}),
    };
    this.emitTask(mapped);
    jobEmit?.(`sub/${mapped.type}`, mapped);
  }

  private emitTask(event: SubagentTaskEvent): void {
    this.options.onTaskEvent?.(event);
  }

  private append(type: string, data: Record<string, unknown>): void {
    const session = this.options.session;
    if (!session) return;
    try { session.appendEvent(type, data); session.flush(); }
    catch { /* the parent session remains the source of truth for the next flush */ }
  }

  private toTaskResult(entry: SubagentCatalogEntry, result: SubagentResult): SubagentTaskResult {
    return {
      taskId: result.childId,
      mode: entry.mode,
      model: entry.model ?? this.options.context.modelId ?? "current",
      provider: result.provider,
      status: "completed",
      content: result.content,
      turns: result.turns ?? 0,
      truncated: result.truncated === true,
      stopReason: "completed",
    };
  }

  taskTool(): ToolDefinition<SubagentStartInput, SubagentTaskResult | JobSnapshot> {
    return defineTool({
      name: "task",
      concurrency: "exclusive",
      description: "Delegate an independent task to a subagent provider. read=file queries; write=also file edits with workspace writes automatically approved; full=all parent-configured capabilities with full access. Providers may be continuable; use task_control to send follow-ups, interrupt, or list children. background=true returns jobId immediately and notifies the parent when the first turn settles. Include all needed context.",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string", minLength: 1, maxLength: this.limits.descriptionCharacters },
          prompt: { type: "string", minLength: 1, maxLength: this.limits.promptCharacters },
          mode: { type: "string", enum: ["read", "write", "full"] },
          provider: { type: "string", enum: this.descriptors().map(provider => provider.name) },
          model: { type: "string", ...(this.options.context.models?.length ? { enum: [...this.options.context.models] } : {}) },
          cwd: { type: "string" },
          background: { type: "boolean" },
        },
        required: ["description", "prompt", "mode"],
        additionalProperties: false,
      },
      parseInput: parseTask,
      assessRisk: input => {
        const cwd = resolve(this.options.workspace, input.cwd ?? ".");
        const provider = this.registry.get(input.provider ?? this.defaultProvider);
        if (!isWithin(this.options.workspace, cwd)) {
          return { kind: "external_file", level: "high", reason: `Start a subagent outside the workspace: ${cwd}.`, target: cwd };
        }
        if (provider && !provider.capabilities.approvals) {
          return { kind: "shell", level: "high", reason: `Start the external ${provider.kind} subagent "${provider.name}".`, target: cwd };
        }
        return { kind: "safe", reason: "Delegate to an in-process child under the parent approval gate." };
      },
      execute: async (input, context) => {
        const jobs = context?.jobs;
        if (!jobs) {
          const managed = await this.start(input, {
            ...(context?.signal ? { signal: context.signal } : {}),
            ...(context?.callId ? { parentCallId: context.callId } : {}),
          });
          const result = await managed.result;
          if (result.status !== "completed") throw new Error(`Task ${result.childId} ${result.status} (${result.stopReason}).`);
          return this.toTaskResult(managed.entry, result);
        }
        const job = jobs.start({ kind: "sub", description: input.description, background: input.background, signal: context?.signal }, async (signal, emit, jobId) => {
          const managed = await this.start({ ...input, childId: jobId }, {
            signal,
            jobs,
            ...(context?.callId ? { parentCallId: context.callId } : {}),
            jobEmit: emit,
          });
          const result = await managed.result;
          if (result.status !== "completed") throw new Error(`Task ${result.childId} ${result.status} (${result.stopReason}).`);
          return this.toTaskResult(managed.entry, result);
        });
        return await jobs.foreground(job.jobId, context?.signal) as SubagentTaskResult | JobSnapshot;
      },
    });
  }

  controlTool(): ToolDefinition<ReturnType<typeof parseControl>, unknown> {
    return defineTool({
      name: "task_control",
      concurrency: "exclusive",
      description: "Inspect or continue delegated subagents in this session: list children, read status, send a follow-up to a continuable child (cold-resuming when needed), or interrupt a running child.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "status", "send", "interrupt"] },
          taskId: { type: "string" },
          prompt: { type: "string", maxLength: this.limits.promptCharacters },
          background: { type: "boolean" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      parseInput: parseControl,
      assessRisk: () => ({ kind: "safe", reason: "Manage subagents owned by this session." }),
      execute: async (input, context) => {
        if (input.action === "list") return { children: this.listChildren() };
        if (!input.taskId) throw new TypeError("taskId is required for this action.");
        if (input.action === "status") {
          const entry = this.listChildren().find(item => item.childId === input.taskId);
          if (!entry) throw new Error(`Unknown subagent "${input.taskId}".`);
          return entry;
        }
        if (input.action === "interrupt") { this.interrupt(input.taskId); return { ok: true, taskId: input.taskId }; }
        if (!input.prompt) throw new TypeError("prompt is required for send.");
        const jobs = context?.jobs;
        if (!jobs || input.background !== true) {
          await this.send(input.taskId, input.prompt, {
            ...(context?.signal ? { signal: context.signal } : {}),
            ...(context?.callId ? { parentCallId: context.callId } : {}),
          });
          return { ok: true, taskId: input.taskId };
        }
        const job = jobs.start({ kind: "sub", description: `Follow-up: ${input.taskId}`, background: true, signal: context?.signal }, async (signal, emit) => {
          await this.send(input.taskId!, input.prompt!, { signal, jobs, ...(context?.callId ? { parentCallId: context.callId } : {}) });
          emit("sub/completed", { taskId: input.taskId });
        });
        return await jobs.foreground(job.jobId, context?.signal);
      },
    });
  }
}
