import { randomUUID } from "node:crypto";
import { Agent, AgentTurnLimitError, ToolRegistry, defineTool, abortable, type AgentEvent, type ModelClient, type ToolDefinition, type ToolExecutionContext, type JobSnapshot } from "@ringko-ai/harness";

export type TaskMode = "read" | "write" | "full";
export type TaskStatus = "running" | "completed" | "failed" | "cancelled";
export interface TaskInput { description: string; prompt: string; mode: TaskMode; model?: string; background?: boolean }
export interface TaskResult { taskId: string; mode: TaskMode; model: string; status: "completed"; content: string; turns: number; truncated: boolean }
export interface TaskEvent {
  taskId: string;
  parentCallId: string | null;
  description: string;
  mode: TaskMode;
  model: string;
  type: "started" | "event" | "completed" | "failed" | "cancelled";
  time: number;
  event?: AgentEvent;
  result?: TaskResult;
  reason?: string;
}
export const TASK_LIMITS = Object.freeze({ maxConcurrent: 2, maxPerRun: 8, maxTurns: 10, timeoutMs: 120_000, promptCharacters: 16_384, descriptionCharacters: 120, resultCharacters: 32_768 });
export interface TaskManagerOptions { model: ModelClient; modelId?: string; models?: readonly string[]; resolveModel?: (id: string) => Promise<ModelClient>; tools: ToolRegistry; onEvent?: (event: TaskEvent) => void }

function parseTask(value: unknown): TaskInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a task object.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !["description", "prompt", "mode", "model", "background"].includes(key))) throw new TypeError("Unexpected task input field.");
  if (typeof data.prompt !== "string" || !data.prompt.trim() || data.prompt.length > TASK_LIMITS.promptCharacters) throw new TypeError("Task prompt must contain 1–16384 characters.");
  if (typeof data.description !== "string" || !data.description.trim() || data.description.length > TASK_LIMITS.descriptionCharacters) throw new TypeError("Task description must contain 1–120 characters.");
  if (data.mode !== "read" && data.mode !== "write" && data.mode !== "full") throw new TypeError("Task mode must be read, write or full.");
  if (data.model !== undefined && (typeof data.model !== "string" || !data.model || data.model.length > 256)) throw new TypeError("Invalid task model.");
  if (data.background !== undefined && typeof data.background !== "boolean") throw new TypeError("background must be boolean.");
  return { prompt: data.prompt, description: data.description.trim(), mode: data.mode, model: data.model as string | undefined, background: data.background as boolean | undefined };
}

/** Independent context, capability allowlist and inherited approval; no recursive task. */
export class TaskManager {
  private active = 0;
  private launched = 0;
  constructor(private readonly options: TaskManagerOptions) {
    if (!options || typeof options.model !== "function" || !(options.tools instanceof ToolRegistry)) throw new TypeError("Task manager requires a model and registry.");
  }
  resetRun(): void {
    if (this.active) throw new Error("Cannot reset task budget while tasks are running.");
    this.launched = 0;
  }
  tool(): ToolDefinition<TaskInput, TaskResult | JobSnapshot> {
    return defineTool({
      name: "task",
      concurrency: "exclusive",
      description: "Delegate an independent task. read=file queries; write=also file edits with workspace writes automatically approved; full=all parent-configured capabilities with full access. No recursive task/job control. Optionally choose a configured provider/model. background=true returns jobId immediately; subscribe to sub events, job retrieves result/cancels. Background completion notifies the parent model. Include all needed context.",
      inputSchema: { type: "object", properties: { description: { type: "string", minLength: 1, maxLength: TASK_LIMITS.descriptionCharacters }, prompt: { type: "string", minLength: 1, maxLength: TASK_LIMITS.promptCharacters }, mode: { type: "string", enum: ["read", "write", "full"] }, model: { type: "string", ...(this.options.models?.length ? { enum: [...this.options.models] } : {}) }, background: { type: "boolean" } }, required: ["description", "prompt", "mode"], additionalProperties: false },
      parseInput: value => {
        const input = parseTask(value);
        if (input.model && (!this.options.models?.includes(input.model) || !this.options.resolveModel)) throw new TypeError("Task model is not configured by this host.");
        return input;
      },
      assessRisk: () => ({ kind: "safe", reason: "Delegate file tools; each child call inherits the parent approval gate." }),
      execute: async (input, context) => {
        if (!context?.jobs) {
          if (input.background) throw new Error("This host does not support background jobs.");
          return this.run(input, context);
        }
        const job = context.jobs.start({ kind: "sub", description: input.description, background: input.background, signal: context.signal }, (signal, emit, jobId) => this.run(input, { ...context, signal }, jobId, emit));
        return await context.jobs.foreground(job.jobId, context.signal) as TaskResult | JobSnapshot;
      },
    });
  }
  private async run(input: TaskInput, context: ToolExecutionContext = {}, id?: string, jobEmit?: (type: string, data: unknown) => void): Promise<TaskResult> {
    context.signal?.throwIfAborted();
    if (this.active >= TASK_LIMITS.maxConcurrent) throw new Error("Task concurrency limit reached.");
    if (this.launched >= TASK_LIMITS.maxPerRun) throw new Error("Task budget exhausted for this run.");
    // Validation and reservation occur synchronously before any asynchronous work.
    this.active++; this.launched++;
    const taskId = id ?? randomUUID();
    const controller = new AbortController();
    const parentAbort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", parentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("Task deadline exceeded.", "TimeoutError")), TASK_LIMITS.timeoutMs);
    const modelId = input.model ?? this.options.modelId ?? "current";
    const emit = (type: TaskEvent["type"], extra: Partial<TaskEvent> = {}) => {
      const event: TaskEvent = { taskId, parentCallId: context.callId ?? null, description: input.description, mode: input.mode, model: modelId, type, time: Date.now(), ...extra };
      this.options.onEvent?.(event); jobEmit?.(`sub/${type}`, event);
    };
    try {
      emit("started");
      const model = input.model ? await abortable(this.options.resolveModel!(input.model), controller.signal) : this.options.model;
      controller.signal.throwIfAborted();
      const childTools = new ToolRegistry();
      for (const tool of this.options.tools.list()) {
        if (["task", "job", "subscribe"].includes(tool.name) || !(input.mode === "full" || tool.taskAccess === "read" || (input.mode === "write" && tool.taskAccess === "write"))) continue;
        childTools.register(defineTool({
          ...tool,
          parseInput: (value: unknown) => value,
          assessRisk: () => ({ kind: "safe", reason: "Forward to the parent capability approval gate." }),
          execute: (value: unknown, childContext) => {
            // Recheck membership at the dispatch boundary. Model arguments cannot elevate mode.
            const capability = this.options.tools.get(tool.name)?.taskAccess;
            if (input.mode !== "full" && capability !== "read" && !(input.mode === "write" && capability === "write")) throw new Error("Task capability denied.");
            const approve = input.mode === "write" ? async (request: Parameters<NonNullable<ToolExecutionContext["requestApproval"]>>[0]) => request.riskKind === "workspace_write" && !request.ruleRequired ? true : await context.requestApproval?.(request) === true : context.requestApproval;
            return this.options.tools.call(tool.name, value, approve, input.mode === "full" ? "full" : context.accessMode, { signal: controller.signal, callId: childContext?.callId, jobs: context.jobs });
          },
        }));
      }
      const agent = new Agent({ model, tools: childTools, signal: controller.signal, maxTurns: TASK_LIMITS.maxTurns,
        instructions: `You are a ${input.mode} agent working on a delegated task. Your context is independent of the parent. Follow the supplied task; report findings, changes, verification and limitations. Do not claim an unavailable capability. Return a concise final answer.`,
        onEvent: event => emit("event", { event }),
      });
      const result = await agent.run(input.prompt);
      controller.signal.throwIfAborted();
      const output: TaskResult = { taskId, mode: input.mode, model: modelId, status: "completed", content: result.content.slice(0, TASK_LIMITS.resultCharacters), turns: result.turns, truncated: result.content.length > TASK_LIMITS.resultCharacters };
      emit("completed", { result: output });
      return output;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const reason = cancelled ? (controller.signal.reason?.name === "TimeoutError" ? "timeout" : "parent_cancelled") : error instanceof AgentTurnLimitError ? "turn_limit" : "execution_failed";
      emit(cancelled ? "cancelled" : "failed", { reason });
      throw new Error(`Task ${taskId} ${cancelled ? "cancelled" : "failed"} (${reason}).`);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", parentAbort);
      this.active--;
    }
  }
}
