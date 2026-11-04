// Runtime contribution contract. Contributions are the extension seam between
// the host runtime and tools/providers/hooks supplied by plugins.

import type { LoadedPlugin, PluginLoadError, RingkoConfig, Skill, SkillInstallScope } from "@ringko-ai/config";
import type { EventBus, EventLog, Scheduler } from "@ringko-ai/runtime";
import type { SessionHandle } from "@ringko-ai/session";
import type { AskHandler, Sandbox, TodoItem } from "@ringko-ai/tools";
import type { CapabilitySnapshot } from "./capabilities.ts";
import type { RingKo } from "./index.ts";
import type { McpManager } from "./mcp-manager.ts";
import type { ToolManager } from "./tool-manager.ts";
import type { PermissionManager } from "./permissions.ts";
import type { RuntimeEvents } from "./runtime-events.ts";

/** A disposer may release resources asynchronously. */
export type Disposable = () => void | Promise<void>;

/** Host callbacks supplied for one agent run. */
export interface RuntimeHost {
  ask?: AskHandler;
  onTodo?: (todos: TodoItem[]) => void;
  report?: (message: string) => void;
}

/** Per-agent services that are not part of the shared runtime context. */
export interface AgentContributionContext {
  host: RuntimeHost;
  session?: SessionHandle;
}

/** Called once for every agent created by the runtime. */
export type AgentContribution = (agent: RingKo, config: RingkoConfig, context: AgentContributionContext) => void | Disposable;

/** Services owned by the workspace runtime and shared by all agents. */
export interface RuntimeContext {
  readonly workspace: string;
  readonly events: EventBus<RuntimeEvents>;
  readonly log: EventLog;
  readonly scheduler: Scheduler;
  readonly permissions: PermissionManager;
  readonly sandbox: Sandbox;
  readonly mcp: Pick<McpManager, "start" | "current" | "ready" | "reset">;
  /** Built-in tool assembly shared by every agent. */
  readonly tools: ToolManager;
  /** Immutable capability snapshot for this workspace. */
  capabilities(): CapabilitySnapshot;
  /** Installed skills visible to this workspace, including plugin skills. */
  skills(): Skill[];
  /** Trusted plugins and manifest errors for this workspace. */
  plugins(): { plugins: LoadedPlugin[]; errors: PluginLoadError[] };
  /** Install a local skill directory and report it via `skill/installed`. */
  installSkill(options: { source: string; scope: SkillInstallScope }): Promise<Skill>;
  /** Register an agent-scoped contribution; returns an idempotent disposer. */
  onAgent(handler: AgentContribution): Disposable;
}

export interface RuntimeContribution {
  /** Stable identity used for duplicate detection and diagnostics. */
  name: string;
  setup(context: RuntimeContext): void | Disposable | Promise<void | Disposable>;
}
