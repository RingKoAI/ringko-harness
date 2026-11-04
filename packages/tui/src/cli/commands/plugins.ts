import { discoverPluginCandidates, isRecord, loadConfig, loadPlugins, savePluginTrust, type PluginTrust } from "@ringko-ai/config";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

function trustedEntries(): PluginTrust[] {
  const trusted = loadConfig().plugins?.trusted;
  if (trusted === undefined) return [];
  if (!Array.isArray(trusted)) throw new TypeError("Plugin trust must be an array of plugin entries.");
  for (const entry of trusted) {
    const valid = typeof entry === "string" || (isRecord(entry) && typeof entry.id === "string" && typeof entry.path === "string");
    if (!valid) throw new TypeError("Plugin trust must contain plugin names or { id, path } entries.");
  }
  return trusted;
}

export function pluginsCommand(parsed: ParsedArgs, io: CliIo): number {
  const [sub = "list", id, ...rest] = parsed.positionals;
  if (rest.length > 0) { io.err("plugins accepts at most one plugin name."); return 2; }

  const config = readConfig(parsed, io);
  if (!config) return 2;
  const workspace = parsed.workspace ?? config.workspace ?? process.cwd();

  if (sub === "list") {
    const result = discoverPluginCandidates({ cwd: workspace });
    for (const error of result.errors) io.err(`${error.source}: ${error.message}`);
    if (result.candidates.length === 0) {
      io.out("No plugins found. Add one under .ringko/plugins or ~/.ringko/plugins.");
      return result.errors.length === 0 ? 0 : 1;
    }
    for (const candidate of [...result.candidates].sort((a, b) => a.id.localeCompare(b.id))) {
      io.out(`${candidate.id}\t${candidate.source}\t${candidate.scope}\t${candidate.trusted ? "trusted" : "untrusted"}`);
    }
    return result.errors.length === 0 ? 0 : 1;
  }

  if (sub !== "trust" && sub !== "untrust") {
    io.err("Usage: plugins [list | trust <name> | untrust <name>]");
    return 2;
  }
  if (!id) { io.err(`plugins ${sub} requires a plugin name.`); return 2; }

  try {
    if (sub === "untrust") {
      const current = trustedEntries();
      savePluginTrust(current.filter(entry => (typeof entry === "string" ? entry : entry.id) !== id));
      io.out(`Plugin ${id} is no longer trusted.`);
      return 0;
    }
    const result = discoverPluginCandidates({ cwd: workspace });
    for (const error of result.errors) io.err(`${error.source}: ${error.message}`);
    const candidate = result.candidates.find(entry => entry.id === id);
    if (!candidate) {
      io.err(`Unknown plugin "${id}".`);
      return 1;
    }
    if (candidate.trusted) { io.out(`Plugin ${id} is already trusted.`); return 0; }
    const current = trustedEntries();
    const bound: PluginTrust = { id, path: candidate.dir };
    const loaded = loadPlugins({ cwd: workspace, trusted: [...current, bound] });
    const plugin = loaded.plugins.find(entry => entry.id === id);
    if (!plugin) {
      const error = loaded.errors.find(entry => entry.source.includes(id));
      io.err(error?.message ?? `Plugin "${id}" has no valid manifest.`);
      return 1;
    }
    savePluginTrust([...current, bound]);
    io.out(`Trusted plugin ${plugin.id} (${plugin.commands.length} command${plugin.commands.length === 1 ? "" : "s"}, ${String(Object.keys(plugin.mcpServers).length)} MCP server${Object.keys(plugin.mcpServers).length === 1 ? "" : "s"}, ${String(plugin.skillDirs.length)} skill director${plugin.skillDirs.length === 1 ? "y" : "ies"}).`);
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Cannot update plugin trust.");
    return 1;
  }
}
