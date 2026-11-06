export { SubagentManager } from "./subagents/manager.ts";
export type { ManagedSubagent, SubagentManagerOptions } from "./subagents/manager.ts";
export { SubagentProviderRegistry } from "./subagents/registry.ts";
export { subagentCatalog, recentCatalog } from "./subagents/catalog.ts";
export { buildSubagentProviders } from "./subagents/config.ts";
export type { SubagentProviderBuild } from "./subagents/config.ts";
export { InProcessProvider } from "./subagents/providers/in-process.ts";
export { OpenAiProvider } from "./subagents/providers/openai.ts";
export type { OpenAiAuth, OpenAiProtocol, OpenAiProviderOptions } from "./subagents/providers/openai.ts";
export { AcpProvider } from "./subagents/providers/acp.ts";
export type { AcpProviderOptions } from "./subagents/providers/acp.ts";
export { CommandProvider, claudeCodeProvider, codexProvider } from "./subagents/providers/command.ts";
export type { CommandProviderOptions, CommandParser } from "./subagents/providers/command.ts";
export {
  SUBAGENT_LIMITS,
  type SubagentCapabilities,
  type SubagentCatalogEntry,
  type SubagentEvent,
  type SubagentEventType,
  type SubagentLimits,
  type SubagentMode,
  type SubagentProvider,
  type SubagentProviderContext,
  type SubagentProviderDescriptor,
  type SubagentResult,
  type SubagentRunHandle,
  type SubagentStartInput,
  type SubagentStatus,
  type SubagentStopReason,
  type SubagentTaskEvent,
  type SubagentTaskResult,
} from "./subagents/types.ts";
