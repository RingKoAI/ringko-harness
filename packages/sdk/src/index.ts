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
  const agent = new Agent({ ...config, tools });

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
      return agent.run(prompt);
    },
  };
}
