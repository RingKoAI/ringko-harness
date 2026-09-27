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
  validateToolDefinition,
} from "@ringko-ai/harness";
import { recordAgentEvent, recordUserMessage, type SessionHandle } from "@ringko-ai/session";
import type {
  Access,
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
  validateToolDefinition,
};
export type {
  Access,
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
}

export interface RingKo {
  readonly tools: ToolRegistry;
  readonly access: Access;
  /** Register a single tool (validated against the harness boundary). */
  register<Input, Output>(tool: ToolDefinition<Input, Output>): void;
  /** Register a bundle atomically; one invalid tool registers none. */
  registerAll(tools: readonly AnyToolDefinition[]): void;
  run(prompt: string): Promise<AgentRunResult>;
}

export function createRingKo(config: RingKoConfig): RingKo {
  if (!config || typeof config.model !== "function") {
    throw new TypeError("RingKo requires a model client.");
  }
  const tools = new ToolRegistry();
  const session = config.session;
  const baseOnEvent = config.onEvent;

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

  const agent = new Agent({
    model: config.model,
    tools,
    ...(config.requestApproval ? { requestApproval: config.requestApproval } : {}),
    ...(config.instructions ? { instructions: config.instructions } : {}),
    ...(config.maxTurns ? { maxTurns: config.maxTurns } : {}),
    ...(onEvent ? { onEvent } : {}),
  });

  return {
    tools,
    access: access(),
    register(tool) {
      tools.register(tool);
    },
    registerAll(bundle) {
      tools.registerAll(bundle);
    },
    run(prompt) {
      if (session) {
        recordUserMessage(session, prompt);
        session.flush();
      }
      return agent.run(prompt);
    },
  };
}
