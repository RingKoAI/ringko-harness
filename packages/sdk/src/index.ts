import {
  ACCESS,
  Agent,
  AgentTurnLimitError,
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  ToolRegistry,
  UnknownToolError,
  access,
  defineTool,
  executeTool,
  gate,
  isAccessMode,
  validateToolDefinition,
} from "@ringko-ai/harness";
import { recordAgentEvent, recordModelCall, recordUserMessage, type SessionHandle } from "@ringko-ai/session";
import type {
  Access,
  AccessMode,
  AnyToolDefinition,
  AgentEvent,
  AgentOptions,
  AgentRunResult,
  ApprovalHandler,
  ChatMessage,
  GateDecision,
  GateRequest,
  ModelClient,
  ModelRequest,
  ModelToolCall,
  ModelTurn,
  RiskKind,
  RiskLevel,
  ToolApprovalRequest,
  ToolDefinition,
  ToolMetadata,
  ToolRiskAssessment,
} from "@ringko-ai/harness";

export {
  ACCESS,
  Agent,
  AgentTurnLimitError,
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  ToolRegistry,
  UnknownToolError,
  access,
  defineTool,
  executeTool,
  gate,
  isAccessMode,
  validateToolDefinition,
};
export type {
  Access,
  AccessMode,
  AnyToolDefinition,
  AgentEvent,
  AgentOptions,
  AgentRunResult,
  ApprovalHandler,
  ChatMessage,
  GateDecision,
  GateRequest,
  ModelClient,
  ModelRequest,
  ModelToolCall,
  ModelTurn,
  RiskKind,
  RiskLevel,
  ToolApprovalRequest,
  ToolDefinition,
  ToolMetadata,
  ToolRiskAssessment,
};

export interface RingKoConfig {
  model: ModelClient;
  requestApproval?: ApprovalHandler;
  instructions?: string;
  maxTurns?: number;
  onEvent?: (event: AgentEvent) => void;
  /** When set, the conversation is recorded to this session log. */
  session?: SessionHandle;
  /** Prior conversation to continue from (resume). */
  history?: readonly ChatMessage[];
  /** Model id sent in requests; recorded as the session's invocation history. */
  modelId?: string;
  /** Permission mode for the approval gate (default: approval). */
  accessMode?: AccessMode;
  /** Max parallel (non-exclusive) tool calls per turn (default: 10). */
  maxParallelTools?: number;
}

export interface RingKo {
  readonly tools: ToolRegistry;
  readonly access: Access;
  /** The running conversation (accumulated across runs; seeded by `history`). */
  readonly history: readonly ChatMessage[];
  /** Register a single tool (validated against the harness boundary). */
  register<Input, Output>(tool: ToolDefinition<Input, Output>): void;
  /** Register a bundle atomically; one invalid tool registers none. */
  registerAll(tools: readonly AnyToolDefinition[]): void;
  /** Run the agent; an optional signal aborts in-flight provider requests. */
  run(prompt: string, options?: { signal?: AbortSignal }): Promise<AgentRunResult>;
}

export function createRingKo(config: RingKoConfig): RingKo {
  if (!config || typeof config.model !== "function") {
    throw new TypeError("RingKo requires a model client.");
  }
  const tools = new ToolRegistry();
  const session = config.session;
  const baseOnEvent = config.onEvent;
  let history: ChatMessage[] = [...(config.history ?? [])];

  const onEvent =
    baseOnEvent || session
      ? (event: AgentEvent): void => {
          baseOnEvent?.(event);
          if (session) {
            recordAgentEvent(session, event);
            session.flush();
          }
        }
      : undefined;

  return {
    tools,
    access: access(config.accessMode),
    register(tool) {
      tools.register(tool);
    },
    registerAll(bundle) {
      tools.registerAll(bundle);
    },
    get history() {
      return history;
    },
    async run(prompt, options) {
      if (session) {
        recordUserMessage(session, prompt);
        if (config.modelId) recordModelCall(session, config.modelId);
        session.flush();
      }
      // A fresh Agent per run so the accumulated history is carried forward.
      const agent = new Agent({
        model: config.model,
        tools,
        ...(config.requestApproval ? { requestApproval: config.requestApproval } : {}),
        ...(config.instructions ? { instructions: config.instructions } : {}),
        ...(config.maxTurns ? { maxTurns: config.maxTurns } : {}),
        ...(onEvent ? { onEvent } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(config.accessMode ? { accessMode: config.accessMode } : {}),
        ...(config.maxParallelTools ? { maxParallelTools: config.maxParallelTools } : {}),
        messages: history,
      });
      const result = await agent.run(prompt);
      history = [...result.messages];
      return result;
    },
  };
}
