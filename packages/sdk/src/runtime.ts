import { resolve } from "node:path";
import { writeDiagnostic, type LoadedPlugin, type PluginLoadError, type RingkoConfig, type Skill, type SkillInstallScope } from "@ringko-ai/config";
import { EventBus, EventLog, Scheduler, createTimeSource } from "@ringko-ai/runtime";
import { Sandbox } from "@ringko-ai/tools";
import { AgentFactory, type RuntimeAgent } from "./agent-factory.ts";
import type { RingKoConfig as AgentConfig } from "./index.ts";
import type { RuntimeEvents } from "./runtime-events.ts";
import { CapabilityManager, type CapabilitySnapshot } from "./capabilities.ts";
import { ExtensionRegistry } from "./extension-registry.ts";
import { PermissionManager } from "./permissions.ts";
import { McpManager } from "./mcp-manager.ts";
import { ToolManager } from "./tool-manager.ts";
import type { AgentContribution, Disposable, RuntimeContext, RuntimeContribution, RuntimeHost } from "./runtime-contribution.ts";
export { registerRuntimeTools } from "./runtime-tools.ts";
export { CapabilityManager } from "./capabilities.ts";
export type { CapabilitySnapshot } from "./capabilities.ts";
export type { RuntimeEvents } from "./runtime-events.ts";
export { ToolManager } from "./tool-manager.ts";
export { ExtensionRegistry } from "./extension-registry.ts";
export { AgentFactory } from "./agent-factory.ts";
export type { AgentFactoryDeps, RuntimeAgent } from "./agent-factory.ts";
export { RuntimeSupervisor } from "./runtime-supervisor.ts";
export type { RuntimeSupervisorOptions } from "./runtime-supervisor.ts";
export type { AgentContribution, AgentContributionContext, Disposable, RuntimeContext, RuntimeContribution, RuntimeHost } from "./runtime-contribution.ts";
export type { PermissionRule } from "./permissions.ts";

/** Workspace resources outlive individual agents, models and sessions. */
export class RuntimeManager {
  readonly workspace: string;
  readonly events = new EventBus<RuntimeEvents>();
  readonly log: EventLog;
  readonly scheduler: Scheduler;
  readonly permissions: PermissionManager;
  readonly sandbox: Sandbox;
  readonly toolManager: ToolManager;
  private readonly stopTime: () => void;
  private readonly capabilityManager: CapabilityManager;
  private readonly extensions: ExtensionRegistry;
  private readonly agentFactory: AgentFactory;
  private readonly mcp: McpManager;
  private closed = false;
  private closing?: Promise<void>;

  constructor(workspace: string, log?: EventLog, configPath?: string) {
    if (typeof workspace !== "string" || !workspace.trim()) throw new TypeError("Runtime requires a workspace.");
    this.workspace = resolve(workspace);
    this.sandbox = new Sandbox({ workspace: this.workspace });
    this.permissions = new PermissionManager(this.workspace);
    this.capabilityManager = new CapabilityManager(this.workspace, configPath);
    this.toolManager = new ToolManager(this.workspace, () => this.capabilityManager.snapshot().skills);
    this.mcp = new McpManager(this.workspace, undefined, () => {
      const snapshot = this.capabilityManager.snapshot();
      return { servers: snapshot.mcpServers, ...(snapshot.mcpError ? { error: snapshot.mcpError } : {}) };
    });
    this.log = log ?? new EventLog();
    this.scheduler = new Scheduler(this.log);
    this.stopTime = log ? () => {} : createTimeSource(this.log);
    this.extensions = new ExtensionRegistry(handlers => this.context(handlers));
    this.extensions.install(this.toolManager.contribution());
    this.agentFactory = new AgentFactory({
      workspace: this.workspace,
      events: this.events,
      log: this.log,
      scheduler: this.scheduler,
      sandbox: this.sandbox,
      permissions: this.permissions,
      toolManager: this.toolManager,
      extensions: this.extensions,
      startMcp: (sandbox, permissions) => this.mcp.start(sandbox, permissions),
    });
  }

  /** Register a contribution and return an idempotent disposer. */
  use(contribution: RuntimeContribution): Promise<Disposable> {
    if (this.closed) return Promise.reject(new Error("Runtime is closed."));
    return this.extensions.use(contribution);
  }

  private context(handlers: Set<AgentContribution>): RuntimeContext {
    return {
      workspace: this.workspace,
      events: this.events,
      log: this.log,
      scheduler: this.scheduler,
      permissions: this.permissions,
      sandbox: this.sandbox,
      mcp: {
        start: (sandbox, permissions) => this.mcp.start(sandbox, permissions),
        current: () => this.mcp.current(),
        ready: () => this.mcp.ready(),
        reset: () => this.mcp.reset(),
      },
      tools: this.toolManager,
      capabilities: () => this.capabilities(),
      skills: () => this.skills(),
      plugins: () => this.plugins(),
      installSkill: options => this.installSkill(options),
      onAgent: handler => this.extensions.add(handlers, handler),
    };
  }

  connections(sandbox: Sandbox = this.sandbox, permissions?: Readonly<Record<string, unknown>>): ReturnType<McpManager["start"]> {
    if (this.closed) return Promise.reject(new Error("Runtime is closed."));
    return this.mcp.start(sandbox, permissions);
  }

  /** Begin MCP connections during host startup, before the first model run. */
  start(sandbox: Sandbox = this.sandbox, permissions?: Readonly<Record<string, unknown>>): ReturnType<McpManager["start"]> { return this.mcp.start(sandbox, permissions); }

  async resetMcp(): Promise<void> {
    await this.mcp.reset();
  }

  /** Current immutable capabilities (plugins, skills, MCP servers). */
  capabilities(): CapabilitySnapshot {
    if (this.closed) throw new Error("Runtime is closed.");
    return this.capabilityManager.snapshot();
  }

  /** Rebuild the capability snapshot and notify observers. */
  reloadCapabilities(): CapabilitySnapshot {
    if (this.closed) throw new Error("Runtime is closed.");
    const snapshot = this.capabilityManager.reload();
    void this.events.parallel("capabilities/changed", snapshot).catch(error => writeDiagnostic("runtime.capabilities", String(error)));
    return snapshot;
  }

  /** Installed skills visible to this workspace, including trusted plugin skills. */
  skills(): Skill[] {
    return [...this.capabilities().skills];
  }

  /** Install a local skill directory and report the result to runtime observers. */
  async installSkill(options: { source: string; scope: SkillInstallScope }): Promise<Skill> {
    if (this.closed) throw new Error("Runtime is closed.");
    const skill = this.capabilityManager.installSkill(options);
    const snapshot = this.capabilityManager.snapshot();
    await this.events.parallel("skill/installed", skill).catch(error => writeDiagnostic("runtime.skill.installed", String(error)));
    await this.events.parallel("capabilities/changed", snapshot).catch(error => writeDiagnostic("runtime.capabilities", String(error)));
    return skill;
  }

  /** Trusted plugins and manifest errors for this workspace. */
  plugins(): { plugins: LoadedPlugin[]; errors: PluginLoadError[] } {
    const snapshot = this.capabilities();
    return { plugins: [...snapshot.plugins], errors: [...snapshot.pluginErrors] };
  }

  /** Snapshot connected MCP servers for discovery/status without starting them. */
  currentConnections(): ReturnType<McpManager["current"]> {
    return this.mcp.current();
  }

  /** Await the startup connection pass, then snapshot discovery. */
  readyConnections(): ReturnType<McpManager["ready"]> {
    return this.mcp.ready();
  }

  /** Build a tool-only agent for capability discovery without starting MCP. */
  previewTools(config: RingkoConfig, host: RuntimeHost = {}): ReturnType<AgentFactory["preview"]> {
    if (this.closed) throw new Error("Runtime is closed.");
    return this.agentFactory.preview(config, host);
  }

  createAgent(config: RingkoConfig, options: AgentConfig, host: RuntimeHost = {}): RuntimeAgent {
    if (this.closed) throw new Error("Runtime is closed.");
    return this.agentFactory.create(config, options, host);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.stopTime();
    for (const task of this.scheduler.list()) this.scheduler.remove(task.id);
    this.permissions.clearSessions();
    this.closing = (async () => {
      const errors: unknown[] = [];
      try { await this.agentFactory.closeAll(); } catch (error) { errors.push(error); }
      try { await this.extensions.dispose(); } catch (error) { errors.push(error); }
      try { this.capabilityManager.close(); } catch (error) { errors.push(error); }
      try { await this.mcp.close(); } catch (error) { errors.push(error); }
      if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Runtime close failed.");
    })();
    return this.closing;
  }
}

