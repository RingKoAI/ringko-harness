import { DEFAULT_ACCESS_MODE, type AccessMode } from "./access.ts";
import type { ApprovalHandler, ToolMetadata, ToolRegistry } from "./tools.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  /** Tool calls the model requested in this assistant turn (arguments included). */
  toolCalls?: readonly ModelToolCall[];
  /** Model reasoning for this assistant turn, when the provider returns it. */
  reasoning?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelTurn {
  content: string;
  toolCalls: readonly ModelToolCall[];
  /** Model reasoning text, when the provider exposes it. */
  reasoning?: string;
}

export interface ModelRequest {
  messages: readonly ChatMessage[];
  tools: readonly ToolMetadata[];
  /** Aborts the underlying provider request (e.g. the user pressed Esc). */
  signal?: AbortSignal;
}

export type ModelClient = (request: ModelRequest) => Promise<ModelTurn>;

export interface AgentEvent {
  type: "model" | "tool" | "tool_error";
  turn: number;
  message: ChatMessage;
  toolName?: string;
  error?: string;
}

export interface AgentRunResult {
  messages: readonly ChatMessage[];
  content: string;
  turns: number;
}

export interface AgentOptions {
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
  private readonly model: ModelClient;
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

  async run(prompt: string): Promise<AgentRunResult> {
    if (prompt.trim().length === 0) {
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
    messages.push({ role: "user", content: prompt });

    for (let turn = 1; turn <= this.maxTurns; turn += 1) {
      const response = await this.model({
        messages,
        tools: this.tools.list(),
        ...(this.signal ? { signal: this.signal } : {}),
      });
      if (!response || typeof response.content !== "string" || !Array.isArray(response.toolCalls)) {
        throw new TypeError("Model client returned an invalid turn.");
      }

      const assistant: ChatMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        ...(response.reasoning ? { reasoning: response.reasoning } : {}),
      };
      messages.push(assistant);
      this.onEvent?.({ type: "model", turn, message: assistant });

      if (response.toolCalls.length === 0) {
        return { messages, content: response.content, turns: turn };
      }

      for (const call of response.toolCalls) {
        if (!call || typeof call.id !== "string" || typeof call.name !== "string") {
          throw new TypeError("Model client returned an invalid tool call.");
        }
      }
      // Schedule the turn's calls: parallel calls batch up to the concurrency
      // limit, exclusive calls run alone as a barrier. Results stay in call
      // order regardless of completion order.
      const results = await this.runToolCalls(response.toolCalls);
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
  ): Promise<Array<{ output: unknown; failed: boolean }>> {
    const results: Array<{ output: unknown; failed: boolean }> = new Array(calls.length);
    let index = 0;
    while (index < calls.length) {
      if (this.tools.get(calls[index].name)?.concurrency === "exclusive") {
        results[index] = await this.invokeTool(calls[index]);
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
          results[batch[at]] = await this.invokeTool(calls[batch[at]]);
        }
      });
      await Promise.all(workers);
    }
    return results;
  }

  private async invokeTool(call: ModelToolCall): Promise<{ output: unknown; failed: boolean }> {
    try {
      const output = await this.tools.call(call.name, call.arguments, this.approvalHandler(), this.accessMode);
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
      const run = this.approvalChain.then(() => handler(request));
      this.approvalChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
  }
}
