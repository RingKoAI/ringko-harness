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
  estimateMessagesTokens,
  estimateTokens,
  estimateToolsTokens,
  executeTool,
  gate,
  isAccessMode,
  validateToolDefinition,
} from "@ringko-ai/harness";
import {
  recordAgentEvent,
  recordModelCall,
  recordSessionCompaction,
  recordUserMessage,
  type SessionHandle,
} from "@ringko-ai/session";
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
  /** Cheaper model used for session titles and compaction (defaults to `model`). */
  smallModel?: ModelClient;
  /** Model context window in tokens (used for the compaction budget). */
  contextWindow?: number;
  /** Reserved output tokens, subtracted from the context window. */
  reserveOutputTokens?: number;
  /** Automatic compaction settings. */
  compaction?: {
    enabled?: boolean;
    /** Trigger at `budget * ratio` (default: 0.8). */
    ratio?: number;
    /** Trailing messages kept verbatim (default: 6). */
    keepRecent?: number;
    /** Safety margin subtracted from the budget (default: 2000). */
    margin?: number;
  };
}

export interface CompactionResult {
  compacted: boolean;
  summary?: string;
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
  /** Estimated tokens currently held (last provider usage, else heuristic). */
  tokens(): number;
  /** Compact the running history into a summary. Manual `/compact`. */
  compact(instructions?: string): Promise<CompactionResult>;
}

export function createRingKo(config: RingKoConfig): RingKo {
  if (!config || typeof config.model !== "function") {
    throw new TypeError("RingKo requires a model client.");
  }
  const tools = new ToolRegistry();
  const session = config.session;
  const baseOnEvent = config.onEvent;
  let history: ChatMessage[] = [...(config.history ?? [])];
  let lastInputTokens: number | undefined;

  const compaction = {
    enabled: true,
    ratio: 0.8,
    keepRecent: 6,
    margin: 2000,
    ...(config.compaction ?? {}),
  };
  const summarizer: ModelClient = config.smallModel ?? config.model;
  const historyTokens = (): number => estimateMessagesTokens(history) + estimateToolsTokens(tools.list());
  const budget = (): number =>
    Math.max(1024, (config.contextWindow ?? 128_000) - (config.reserveOutputTokens ?? 4096) - compaction.margin);
  const overThreshold = (extra = 0): boolean =>
    compaction.enabled && (lastInputTokens ?? historyTokens()) + extra >= budget() * compaction.ratio;

  async function compact(instructions?: string): Promise<CompactionResult> {
    const systems = history.filter((message) => message.role === "system");
    const rest = history.filter((message) => message.role !== "system");
    const keep = Math.max(0, compaction.keepRecent);
    if (rest.length <= keep + 1) return { compacted: false };
    const middle = rest.slice(0, rest.length - keep);
    const recent = rest.slice(rest.length - keep);
    const transcript = middle.map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 200_000);
    const summaryTurn = await summarizer({
      messages: [
        {
          role: "system",
          content:
            "You compact an agent conversation. Preserve decisions, file paths, code facts, tool outcomes, and open tasks. Be concise and factual; no preamble.",
        },
        {
          role: "user",
          content: `Summarize the conversation so far for continuity.\n\n${transcript}${instructions ? `\n\nExtra focus: ${instructions}` : ""}`,
        },
      ],
      tools: [],
    });
    const summary = summaryTurn.content.trim();
    if (summary.length === 0) return { compacted: false };
    history = [...systems, { role: "system", content: `Conversation summary so far:\n${summary}` }, ...recent];
    lastInputTokens = undefined;
    if (session) {
      recordSessionCompaction(session, summary);
      session.flush();
    }
    return { compacted: true, summary };
  }

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
    tokens() {
      return lastInputTokens ?? historyTokens();
    },
    compact,
    async run(prompt, options) {
      // Auto-compact before recording the prompt: the log order stays
      // [.., compaction, user] so replay resumes the compacted history.
      if (overThreshold(estimateTokens(prompt))) {
        try {
          await compact();
        } catch {
          // Compaction is best effort; continue with the full history.
        }
      }
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
      lastInputTokens = result.usage?.inputTokens ?? historyTokens();
      return result;
    },
  };
}
