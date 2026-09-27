import {
  ACCESS,
  Agent,
  AgentTurnLimitError,
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  ToolRegistry,
  UnknownToolError,
  access,
  executeTool,
  gate,
} from "@ringko-ai/harness";
import type {
  Access,
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
  executeTool,
  gate,
};
export type {
  Access,
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
}

export interface RingKo {
  readonly tools: ToolRegistry;
  readonly access: Access;
  register<Input, Output>(tool: ToolDefinition<Input, Output>): void;
  run(prompt: string): Promise<AgentRunResult>;
}

export function createRingKo(config: RingKoConfig): RingKo {
  if (!config || typeof config.model !== "function") {
    throw new TypeError("RingKo requires a model client.");
  }
  const tools = new ToolRegistry();
  const agent = new Agent({ ...config, tools });

  return {
    tools,
    access: access(),
    register(tool) {
      tools.register(tool);
    },
    run(prompt) {
      return agent.run(prompt);
    },
  };
}
