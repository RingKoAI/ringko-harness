// Runtime contribution contract. Contributions are the extension seam between
// the host runtime and tools/providers/hooks supplied by plugins.

import type { RingkoConfig } from "@ringko-ai/config";
import type { EventBus, EventLog, Scheduler } from "@ringko-ai/runtime";
import type { Sandbox } from "@ringko-ai/tools";
import type { RingKo } from "./index.ts";
import type { McpManager } from "./mcp-manager.ts";
import type { PermissionManager } from "./permissions.ts";
import type { RuntimeEvents } from "./runtime.ts";

/** A disposer may release resources asynchronously. */
export type Disposable = () => void | Promise<void>;

/** Called once for every agent created by the runtime. */
export type AgentContribution = (agent: RingKo, config: RingkoConfig) => void | Disposable;

/** Services owned by the workspace runtime and shared by all agents. */
export interface RuntimeContext {
  readonly workspace: string;
  readonly events: EventBus<RuntimeEvents>;
  readonly log: EventLog;
  readonly scheduler: Scheduler;
  readonly permissions: PermissionManager;
  readonly sandbox: Sandbox;
  readonly mcp: Pick<McpManager, "start" | "current" | "ready" | "reset">;
  /** Register an agent-scoped contribution; returns an idempotent disposer. */
  onAgent(handler: AgentContribution): Disposable;
}

export interface RuntimeContribution {
  /** Stable identity used for duplicate detection and diagnostics. */
  name: string;
  setup(context: RuntimeContext): void | Disposable | Promise<void | Disposable>;
}
