import type { ApprovalHandler, ToolMetadata, ToolRegistry } from "./tools.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  /** Tool calls the model requested in this assistant turn (arguments included). */
  toolCalls?: readonly ModelToolCall[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelTurn {
  content: string;
  toolCalls: readonly ModelToolCall[];
}

export interface ModelRequest {
  messages: readonly ChatMessage[];
  tools: readonly ToolMetadata[];
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
}

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
  }

  async run(prompt: string): Promise<AgentRunResult> {
    if (prompt.trim().length === 0) {
      throw new TypeError("Agent prompt must not be empty.");
    }

    const messages: ChatMessage[] = [];
    if (this.instructions && this.instructions.trim().length > 0) {
      messages.push({ role: "system", content: this.instructions });
    }
    messages.push({ role: "user", content: prompt });

    for (let turn = 1; turn <= this.maxTurns; turn += 1) {
      const response = await this.model({
        messages,
        tools: this.tools.list(),
      });
      if (!response || typeof response.content !== "string" || !Array.isArray(response.toolCalls)) {
        throw new TypeError("Model client returned an invalid turn.");
      }

      const assistant: ChatMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
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
        let output: unknown;
        let failed = false;
        try {
          output = await this.tools.call(call.name, call.arguments, this.requestApproval);
        } catch (error) {
          failed = true;
          output = error instanceof Error ? error.message : "Tool execution failed.";
        }
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
      }
    }

    throw new AgentTurnLimitError(this.maxTurns);
  }
}
