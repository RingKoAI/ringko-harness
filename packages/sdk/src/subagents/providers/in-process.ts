import { randomUUID } from "node:crypto";
import {
  Agent,
  AgentTurnLimitError,
  type ChatMessage,
  type ModelClient,
} from "@ringko-ai/harness";
import {
  recordAgentEvent,
  recordInstructions,
  recordUserMessage,
  toChatMessages,
  type SessionHandle,
} from "@ringko-ai/session";
import { buildChildTools } from "../child-tools.ts";
import {
  SUBAGENT_LIMITS,
  type SubagentCatalogEntry,
  type SubagentMode,
  type SubagentProvider,
  type SubagentProviderContext,
  type SubagentResult,
  type SubagentRunHandle,
  type SubagentStartInput,
} from "../types.ts";

interface PendingTurn {
  content: string;
  signal?: AbortSignal;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface LocalChild {
  id: string;
  provider: string;
  description: string;
  mode: SubagentMode;
  modelId?: string;
  model: ModelClient;
  cwd: string;
  parentCallId: string | null;
  context: SubagentProviderContext;
  session?: SessionHandle;
  sessionId?: string;
  memory: ChatMessage[];
  instructionsRecorded: boolean;
  queue: PendingTurn[];
  running: boolean;
  disposed: boolean;
  controller?: AbortController;
  disposeController: AbortController;
  turns: number;
  last?: SubagentResult;
  result: PromiseWithResolvers<SubagentResult>;
}

function instructions(mode: SubagentMode, cwd: string): string {
  return `You are a ${mode} subagent working on a delegated task. Your working directory is ${JSON.stringify(cwd)}; relative file paths resolve there. Tool result roots are absolute paths. Your context is independent of the parent. Follow the supplied task; report findings, changes, verification and limitations. Do not claim an unavailable capability. Return a concise final answer.`;
}

function clip(text: string, limit: number): { content: string; truncated: boolean } {
  return text.length > limit ? { content: text.slice(0, limit), truncated: true } : { content: text, truncated: false };
}

function abortReasonName(reason: unknown): string | undefined {
  return reason && typeof reason === "object" && "name" in reason ? String((reason as { name?: unknown }).name) : undefined;
}

function tokenModel(context: SubagentProviderContext, requested?: string): Promise<ModelClient> {
  if (!requested) return Promise.resolve(context.model);
  if (!context.resolveModel) throw new Error("This host cannot resolve a subagent model.");
  return context.resolveModel(requested);
}

/**
 * Durable, continuable child backed by a RingKo Agent. Every turn is an
 * independent Agent run over the child's own session log, so follow-up prompts
 * and cold resume share one transcript while never touching parent history.
 */
export class InProcessProvider implements SubagentProvider {
  readonly kind = "in-process";
  readonly capabilities = Object.freeze({
    continuable: true,
    resume: true,
    modelSelection: true,
    tools: true,
    approvals: true,
  });
  readonly name: string;
  readonly description: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;

  constructor(options: { name?: string; description?: string; maxTurns?: number; timeoutMs?: number } = {}) {
    this.name = options.name ?? "in-process";
    this.description = options.description ?? "Durable in-process child with workspace tools, approval inheritance, and follow-up turns.";
    this.maxTurns = options.maxTurns ?? SUBAGENT_LIMITS.maxTurns;
    this.timeoutMs = options.timeoutMs ?? SUBAGENT_LIMITS.timeoutMs;
  }

  async start(input: SubagentStartInput & { cwd: string }, context: SubagentProviderContext): Promise<SubagentRunHandle> {
    const session = context.sessionStore
      ? context.sessionStore.create({
          ...(context.parentSessionId ? { parentSession: context.parentSessionId } : {}),
          cwd: input.cwd,
          attributes: { subagent: { provider: this.name, description: input.description, mode: input.mode } },
        })
      : undefined;
    const child = await this.child(input, context, session);
    const pending = this.turn(input.prompt);
    return this.handle(child, pending);
  }

  async resume(entry: SubagentCatalogEntry, context: SubagentProviderContext): Promise<SubagentRunHandle> {
    if (!entry.sessionId) throw new Error(`Subagent ${entry.childId} has no durable session to resume.`);
    if (!context.sessionStore) throw new Error("This host has no session store for subagent resume.");
    const session = context.sessionStore.open(entry.sessionId, "write");
    const child = await this.child({
      childId: entry.childId,
      description: entry.description,
      mode: entry.mode,
      ...(entry.model ? { model: entry.model } : {}),
      cwd: entry.cwd || context.workspace,
      prompt: "",
    }, context, session);
    child.parentCallId = entry.parentCallId;
    const result = child.result.promise;
    return {
      childId: child.id,
      provider: this.name,
      ...(child.modelId ? { modelId: child.modelId } : {}),
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      capabilities: this.capabilities,
      result,
      send: async (content, signal) => this.send(child, content, signal),
      interrupt: () => this.interrupt(child),
      dispose: () => this.dispose(child),
    };
  }

  private async child(
    input: SubagentStartInput & { cwd: string },
    context: SubagentProviderContext,
    session?: SessionHandle,
  ): Promise<LocalChild> {
    const model = await tokenModel(context, input.model);
    const id = input.childId ?? randomUUID();
    return {
      id,
      provider: this.name,
      description: input.description,
      mode: input.mode,
      ...(input.model ? { modelId: input.model } : { ...(context.modelId ? { modelId: context.modelId } : {}) }),
      model,
      cwd: input.cwd,
      parentCallId: null,
      context,
      ...(session ? { session, sessionId: session.id } : {}),
      memory: [],
      instructionsRecorded: false,
      queue: [],
      running: false,
      disposed: false,
      disposeController: new AbortController(),
      turns: 0,
      result: Promise.withResolvers<SubagentResult>(),
    };
  }

  private handle(child: LocalChild, pending: PendingTurn): SubagentRunHandle {
    const first = pending;
    void this.runTurn(child, first);
    return {
      childId: child.id,
      provider: this.name,
      ...(child.modelId ? { modelId: child.modelId } : {}),
      ...(child.sessionId ? { sessionId: child.sessionId } : {}),
      capabilities: this.capabilities,
      result: child.result.promise,
      send: async (content, signal) => this.send(child, content, signal),
      interrupt: () => this.interrupt(child),
      dispose: () => this.dispose(child),
    };
  }

  private turn(content: string, signal?: AbortSignal): PendingTurn {
    return { content, ...(signal ? { signal } : {}), resolve: () => {}, reject: () => {} };
  }

  private send(child: LocalChild, content: string, signal?: AbortSignal): Promise<void> {
    if (child.disposed) return Promise.reject(new Error("Subagent is disposed."));
    if (typeof content !== "string" || content.trim().length === 0) return Promise.reject(new TypeError("Subagent message must not be empty."));
    if (content.length > SUBAGENT_LIMITS.promptCharacters) return Promise.reject(new TypeError("Subagent message is too long."));
    return new Promise<void>((resolve, reject) => {
      const pending: PendingTurn = { content, ...(signal ? { signal } : {}), resolve, reject };
      child.queue.push(pending);
      if (!child.running) this.drain(child);
    });
  }

  private interrupt(child: LocalChild): void {
    child.controller?.abort(new DOMException("Subagent interrupted.", "SubagentInterrupted"));
  }

  private async dispose(child: LocalChild): Promise<void> {
    if (child.disposed) return;
    child.disposed = true;
    child.disposeController.abort(new DOMException("Subagent disposed.", "SubagentDisposed"));
    child.controller?.abort(new DOMException("Subagent disposed.", "SubagentDisposed"));
    for (const pending of child.queue.splice(0)) pending.reject(new Error("Subagent disposed."));
    if (!child.running) this.settleInitial(child, child.last ?? this.cancelledResult(child, "aborted"));
    try { child.session?.close(); } catch { /* best effort */ }
  }

  private drain(child: LocalChild): void {
    if (child.running || child.disposed) return;
    const pending = child.queue.shift();
    if (pending) void this.runTurn(child, pending);
  }

  private async runTurn(child: LocalChild, pending: PendingTurn): Promise<void> {
    child.running = true;
    try {
      const result = await this.executeTurn(child, pending);
      child.last = result;
      this.settleInitial(child, result);
      if (result.status === "completed") pending.resolve();
      else pending.reject(new Error(result.diagnostic ?? `Subagent ${result.status}.`));
    } catch (error) {
      const result = this.failureResult(child, error);
      child.last = result;
      this.settleInitial(child, result);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      child.controller = undefined;
      child.running = false;
      if (!child.disposed) this.drain(child);
    }
  }

  private settleInitial(child: LocalChild, result: SubagentResult): void {
    // Promise.withResolvers has no public settled flag; a second resolve is a no-op.
    child.result.resolve(result);
  }

  private async executeTurn(child: LocalChild, pending: PendingTurn): Promise<SubagentResult> {
    const context = child.context;
    if (child.disposed) throw new Error("Subagent disposed.");
    const controller = new AbortController();
    const parentSignal = pending.signal ?? context.signal;
    const onDispose = () => controller.abort(child.disposeController.signal.reason);
    const onParent = () => controller.abort(parentSignal?.reason);
    child.disposeController.signal.addEventListener("abort", onDispose, { once: true });
    parentSignal?.addEventListener("abort", onParent, { once: true });
    if (parentSignal?.aborted) onParent();
    const timer = setTimeout(() => controller.abort(new DOMException("Subagent deadline exceeded.", "TimeoutError")), this.timeoutMs);
    child.controller = controller;
    const instructionsText = instructions(child.mode, child.cwd);
    try {
      context.onEvent?.({ childId: child.id, provider: this.name, type: "status", status: "running", time: Date.now() });
      const history = child.session ? toChatMessages(child.session.all()) : child.memory;
      if (child.session) {
        if (!child.instructionsRecorded) { recordInstructions(child.session, instructionsText); child.instructionsRecorded = true; }
        recordUserMessage(child.session, pending.content);
        child.session.flush();
      }
      context.onEvent?.({ childId: child.id, provider: this.name, type: "message", message: { role: "user", content: pending.content }, time: Date.now() });
      const tools = buildChildTools(context.tools, child.mode, {
        cwd: child.cwd,
        workspace: context.workspace,
        ...(context.requestApproval ? { requestApproval: context.requestApproval } : {}),
        ...(context.accessMode ? { accessMode: context.accessMode } : {}),
        ...(context.jobs ? { jobs: context.jobs } : {}),
        signal: controller.signal,
      });
      const agent = new Agent({
        model: child.model,
        tools,
        signal: controller.signal,
        maxTurns: this.maxTurns,
        instructions: instructionsText,
        messages: history,
        onEvent: event => {
          if (child.session) {
            try { recordAgentEvent(child.session, event); child.session.flush(); } catch { /* transcript stays the source of truth */ }
          }
          context.onEvent?.({ childId: child.id, provider: this.name, type: "agent", agentEvent: event, time: Date.now() });
        },
      });
      const turn = await agent.run(pending.content);
      controller.signal.throwIfAborted();
      if (!child.session) child.memory = [...turn.messages];
      child.turns += turn.turns;
      const clipped = clip(turn.content, SUBAGENT_LIMITS.resultCharacters);
      const result: SubagentResult = {
        childId: child.id,
        provider: this.name,
        status: "completed",
        content: clipped.content,
        stopReason: "completed",
        turns: child.turns,
        ...(clipped.truncated ? { truncated: true } : {}),
        ...(child.sessionId ? { metadata: { sessionId: child.sessionId } } : {}),
      };
      context.onEvent?.({ childId: child.id, provider: this.name, type: "message", message: { role: "assistant", content: clipped.content }, time: Date.now() });
      context.onEvent?.({ childId: child.id, provider: this.name, type: "status", status: "completed", time: Date.now(), result });
      return result;
    } catch (error) {
      const result = this.failureResult(child, error, controller.signal.reason);
      context.onEvent?.({ childId: child.id, provider: this.name, type: "status", status: result.status, time: Date.now(), result });
      return result;
    } finally {
      clearTimeout(timer);
      child.disposeController.signal.removeEventListener("abort", onDispose);
      parentSignal?.removeEventListener("abort", onParent);
    }
  }

  private failureResult(child: LocalChild, error: unknown, reason?: unknown): SubagentResult {
    const aborted = reason !== undefined || child.disposeController.signal.aborted;
    if (aborted) {
      const name = abortReasonName(reason ?? child.disposeController.signal.reason);
      const stop = name === "TimeoutError" ? "timeout" : name === "JobCancelled" || name === "SubagentInterrupted" || name === "SubagentDisposed" ? "cancelled" : "aborted";
      return this.cancelledResult(child, stop);
    }
    const turnLimit = error instanceof AgentTurnLimitError;
    const content = child.last?.content ?? "";
    return {
      childId: child.id,
      provider: this.name,
      status: "failed",
      content,
      stopReason: turnLimit ? "turn_limit" : "error",
      turns: child.turns,
      diagnostic: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      ...(child.sessionId ? { metadata: { sessionId: child.sessionId } } : {}),
    };
  }

  private cancelledResult(child: LocalChild, stopReason: "aborted" | "cancelled" | "timeout"): SubagentResult {
    return {
      childId: child.id,
      provider: this.name,
      status: "cancelled",
      content: child.last?.content ?? "",
      stopReason,
      turns: child.turns,
      ...(stopReason === "timeout" ? { diagnostic: "Subagent deadline exceeded." } : {}),
      ...(child.sessionId ? { metadata: { sessionId: child.sessionId } } : {}),
    };
  }
}
