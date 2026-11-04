// Workspace capability snapshot.
//
// RuntimeManager delegates discovery here so one revision reads plugin
// manifests once and every consumer (skills, MCP, hosts) sees the same view.
// Discoverers stay in @ringko-ai/config; this class only coordinates them.

import {
  discoverSkills,
  installSkill as installSkillDirectory,
  loadMcpServers,
  loadPlugins,
  type LoadedPlugin,
  type McpServer,
  type PluginLoadError,
  type Skill,
  type SkillInstallScope,
} from "@ringko-ai/config";

export interface CapabilitySnapshot {
  /** Monotonic revision; every reload creates a new value. */
  revision: number;
  plugins: readonly LoadedPlugin[];
  pluginErrors: readonly PluginLoadError[];
  skills: readonly Skill[];
  mcpServers: readonly McpServer[];
  /** Present when explicit MCP configuration could not be read. */
  mcpError?: string;
}

/** Owns the immutable capability view for one workspace. */
export class CapabilityManager {
  private current?: CapabilitySnapshot;
  private revision = 0;
  private closed = false;

  constructor(private readonly workspace: string, private readonly configPath?: string) {}

  /** The current snapshot, loading it on first use. */
  snapshot(): CapabilitySnapshot {
    if (this.closed) throw new Error("Capability manager is closed.");
    this.current ??= this.load();
    return this.current;
  }

  /** Rebuild atomically; a failed load keeps the previous snapshot. */
  reload(): CapabilitySnapshot {
    if (this.closed) throw new Error("Capability manager is closed.");
    this.current = this.load();
    return this.current;
  }

  /** Install a skill and refresh the snapshot before returning. */
  installSkill(options: { source: string; scope: SkillInstallScope }): Skill {
    if (this.closed) throw new Error("Capability manager is closed.");
    const skill = installSkillDirectory({ ...options, cwd: this.workspace });
    this.current = this.load();
    return skill;
  }

  close(): void {
    this.closed = true;
    this.current = undefined;
  }

  private load(): CapabilitySnapshot {
    const plugins = loadPlugins({ cwd: this.workspace, ...(this.configPath ? { configPath: this.configPath } : {}) });
    const skills = discoverSkills({ cwd: this.workspace, plugins: plugins.plugins });
    let mcpServers: McpServer[] = [];
    let mcpError: string | undefined;
    try {
      mcpServers = loadMcpServers({ cwd: this.workspace, plugins: plugins.plugins, ...(this.configPath ? { configPath: this.configPath } : {}) });
    } catch (error) {
      mcpError = error instanceof Error ? error.message : "Invalid MCP configuration.";
      // Explicit configuration failed, but trusted plugin servers still have a
      // valid source; keep them available instead of dropping every server.
      mcpServers = plugins.plugins.flatMap(plugin => Object.entries(plugin.mcpServers).map(([name, config]) => ({
        name,
        config,
        source: plugin.source,
        scope: plugin.scope,
      })));
    }
    this.revision += 1;
    return {
      revision: this.revision,
      plugins: plugins.plugins,
      pluginErrors: plugins.errors,
      skills,
      mcpServers,
      ...(mcpError ? { mcpError } : {}),
    };
  }
}
