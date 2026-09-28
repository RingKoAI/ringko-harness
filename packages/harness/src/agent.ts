import { DEFAULT_ACCESS_MODE, type AccessMode } from "./access.ts";
import type { ApprovalHandler, ToolMetadata, ToolRegistry } from "./tools.ts";
import { abortable } from "./cancellation.ts";
import type { JobManager } from "./jobs.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  /** Tool calls the model requested in this assistant turn (arguments included). */
  toolCalls?: readonly ModelToolCall[];
  /** Model reasoning for this assistant turn, when the provider returns it. */
  reasoning?: string;
  /**
   * Provider reasoning blocks for this turn, replayable verbatim. Each block
   * carries its text plus the provider options (e.g. an Anthropic thinking
   * signature) needed to resend it unchanged on the next request.
   */
  reasoningDetails?: readonly ReasoningDetail[];
}

/** One provider reasoning block, replayable verbatim. */
export interface ReasoningDetail {
  text: string;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Prompt-cache read tokens, when the provider reports them. */
  cacheReadTokens?: number;
  /** Prompt-cache write tokens, when the provider reports them. */
  cacheWriteTokens?: number;
}

export interface ModelTurn {
  content: string;
  toolCalls: readonly ModelToolCall[];
  /** Model reasoning text, when the provider exposes it. */
  reasoning?: string;
  /** Provider reasoning blocks, replayed verbatim on the next request. */
  reasoningDetails?: readonly ReasoningDetail[];
  /** Token usage reported by the provider, when available. */
  usage?: ModelUsage;
}

export interface ModelRequest {
  messages: readonly ChatMessage[];
  tools: readonly ToolMetadata[];
  /** Aborts the underlying provider request (e.g. the user pressed Esc). */
  signal?: AbortSignal;
  /** Transient presentation chunks; only the completed turn enters history. */
  onDelta?: (delta: ModelDelta) => void;
}

export interface ModelDelta { kind: "text" | "reasoning"; text: string }

export type ModelClient = (request: ModelRequest) => Promise<ModelTurn>;

export interface AgentEvent {
  type: "model" | "tool_call" | "tool" | "tool_error";
  turn: number;
  message: ChatMessage;
  toolName?: string;
  error?: string;
}

export interface AgentRunResult {
  messages: readonly ChatMessage[];
  content: string;
  turns: number;
  /** Usage of the final model turn, when the provider reported it. */
  usage?: ModelUsage;
}

export interface AgentOptions {
  onDelta?: (delta: ModelDelta) => void;
  jobs?: JobManager;
  model: ModelClient;
  tools: ToolRegistry;
  requestApproval?: ApprovalHandler;
  instructions?: string;
  maxTurns?: number;
  onEvent?: (event: AgentEvent) => void;
  /** Prior conversation to continue from (resume). */
  messages?: readonly ChatMessage[];
  /** Aborts in-flight provider requests. */
  signal?: AbortSignal;
  /** Permission mode for the approval gate (default: approval). */
  accessMode?: AccessMode;
  /** Max parallel (non-exclusive) tool calls per turn (default: 10). */
  maxParallelTools?: number;
}

const DEFAULT_MAX_PARALLEL_TOOLS = 10;

export class AgentTurnLimitError extends Error {
  constructor(maxTurns: number) {
    super(`Agent stopped after ${String(maxTurns)} turns without a final response.`);
    this.name = "AgentTurnLimitError";
  }
}

const DEFAULT_MAX_TURNS = 8;

function serialize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value) ?? "null";
}

export class Agent {
  private readonly onDelta?: (delta: ModelDelta) => void;
  private readonly model: ModelClient;
  private readonly jobs?: JobManager;
  private readonly tools: ToolRegistry;
  private readonly requestApproval?: ApprovalHandler;
  private readonly instructions?: string;
  private readonly maxTurns: number;
  private readonly onEvent?: (event: AgentEvent) => void;
  private readonly initialMessages: readonly ChatMessage[];
  private readonly signal?: AbortSignal;
  private readonly accessMode: AccessMode;
  private readonly maxParallelTools: number;
  /** Serializes approval prompts so a host sees at most one at a time. */
  private approvalChain: Promise<unknown> = Promise.resolve();

  constructor(options: AgentOptions) {
    if (typeof options.model !== "function") {
      throw new TypeError("Agent requires a model client.");
    }
    if (!options.tools || typeof options.tools.list !== "function" || typeof options.tools.call !== "function") {
      throw new TypeError("Agent requires a tool registry.");
    }
    if (options.maxTurns !== undefined && (!Number.isInteger(options.maxTurns) || options.maxTurns < 1)) {
      throw new TypeError("maxTurns must be a positive integer.");
    }
    this.model = options.model;
    this.onDelta = options.onDelta;
    this.jobs = options.jobs;
    this.tools = options.tools;
    this.requestApproval = options.requestApproval;
    this.instructions = options.instructions;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.onEvent = options.onEvent;
    this.initialMessages = options.messages ?? [];
    this.signal = options.signal;
    this.accessMode = options.accessMode ?? DEFAULT_ACCESS_MODE;
    if (
      options.maxParallelTools !== undefined &&
      (!Number.isInteger(options.maxParallelTools) || options.maxParallelTools < 1)
    ) {
      throw new TypeError("maxParallelTools must be a positive integer.");
    }
    this.maxParallelTools = options.maxParallelTools ?? DEFAULT_MAX_PARALLEL_TOOLS;
  }

  async run(prompt?: string): Promise<AgentRunResult> {
    if ((prompt !== undefined && prompt.trim().length === 0) || (prompt === undefined && !this.initialMessages.length)) {
      throw new TypeError("Agent prompt must not be empty.");
    }

    const messages: ChatMessage[] = [...this.initialMessages];
    if (
      this.instructions &&
      this.instructions.trim().length > 0 &&
      !messages.some((message) => message.role === "system")
    ) {
      messages.unshift({ role: "system", content: this.instructions });
    }
    if (prompt !== undefined) messages.push({ role: "user", content: prompt });

    let lastUsage: ModelUsage | undefined;
    for (let turn = 1; turn <= this.maxTurns; turn += 1) {
      this.signal?.throwIfAborted();
      const response = await abortable(this.model({
        messages,
        tools: this.tools.list(),
        ...(this.onDelta ? { onDelta: (delta: ModelDelta) => { this.signal?.throwIfAborted(); this.onDelta?.(delta); } } : {}),
        ...(this.signal ? { signal: this.signal } : {}),
      }), this.signal);
      this.signal?.throwIfAborted();
      if (!response || typeof response.content !== "string" || !Array.isArray(response.toolCalls)) {
        throw new TypeError("Model client returned an invalid turn.");
      }

      const callIds = new Set<string>();
      for (const call of response.toolCalls) {
        if (!call || typeof call.id !== "string" || call.id.length === 0 || typeof call.name !== "string" || call.name.length === 0 || callIds.has(call.id)) {
          throw new TypeError("Model client returned an invalid tool call.");
        }
        callIds.add(call.id);
      }

      const assistant: ChatMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        ...(response.reasoning ? { reasoning: response.reasoning } : {}),
        ...(response.reasoningDetails && response.reasoningDetails.length > 0 ? { reasoningDetails: response.reasoningDetails } : {}),
      };
      messages.push(assistant);
      this.onEvent?.({ type: "model", turn, message: assistant });
      lastUsage = response.usage;

      if (response.toolCalls.length === 0) {
        return { messages, content: response.content, turns: turn, ...(lastUsage ? { usage: lastUsage } : {}) };
      }

      // Schedule the turn's calls: parallel calls batch up to the concurrency
      // limit, exclusive calls run alone as a barrier. Results stay in call
      // order regardless of completion order.
      const results = await this.runToolCalls(response.toolCalls, turn);
      this.signal?.throwIfAborted();
      response.toolCalls.forEach((call, index) => {
        const { output, failed } = results[index];
        const toolMessage: ChatMessage = {
          role: "tool",
          content: serialize(output),
          toolCallId: call.id,
          name: call.name,
        };
        messages.push(toolMessage);
        this.onEvent?.({
          type: failed ? "tool_error" : "tool",
          turn,
          message: toolMessage,
          toolName: call.name,
          error: failed ? toolMessage.content : undefined,
        });
      });
    }

    throw new AgentTurnLimitError(this.maxTurns);
  }

  /** Execute one turn's tool calls under the concurrency/fence schedule. */
  private async runToolCalls(
    calls: readonly ModelToolCall[],
    turn: number,
  ): Promise<Array<{ output: unknown; failed: boolean }>> {
    const results: Array<{ output: unknown; failed: boolean }> = new Array(calls.length);
    let index = 0;
    while (index < calls.length) {
      if (this.tools.get(calls[index].name)?.concurrency === "exclusive") {
        results[index] = await this.invokeTool(calls[index], turn);
        index += 1;
        continue;
      }
      const batch: number[] = [];
      while (index < calls.length && this.tools.get(calls[index].name)?.concurrency !== "exclusive") {
        batch.push(index);
        index += 1;
      }
      let cursor = 0;
      const workers = Array.from({ length: Math.min(this.maxParallelTools, batch.length) }, async () => {
        for (;;) {
          const at = cursor;
          cursor += 1;
          if (at >= batch.length) return;
          results[batch[at]] = await this.invokeTool(calls[batch[at]], turn);
        }
      });
      await Promise.all(workers);
    }
    return results;
  }

  private async invokeTool(call: ModelToolCall, turn: number): Promise<{ output: unknown; failed: boolean }> {
    this.onEvent?.({
      type: "tool_call",
      turn,
      message: { role: "assistant", content: "", toolCalls: [call] },
      toolName: call.name,
    });
    try {
      const output = await this.tools.call(call.name, call.arguments, this.approvalHandler(), this.accessMode, { signal: this.signal, callId: call.id, jobs: this.jobs });
      return { output, failed: false };
    } catch (error) {
      return { output: error instanceof Error ? error.message : "Tool execution failed.", failed: true };
    }
  }

  /** Wrap the approval handler so concurrent calls prompt one at a time. */
  private approvalHandler(): ApprovalHandler | undefined {
    const handler = this.requestApproval;
    if (!handler) return undefined;
    return async (request) => {
      const run = this.approvalChain.then(() => { this.signal?.throwIfAborted(); request.signal?.throwIfAborted(); return handler(request); });
      this.approvalChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
  }
}
