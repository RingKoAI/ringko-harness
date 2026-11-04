// Declarative plugins.
//
// A plugin is a directory under `<root>/plugins/<id>` containing `plugin.json`.
// Manifests contribute skills, prompt commands and MCP servers; they cannot run
// code. Plugins are ignored unless the user lists their id in
// `settings.local.json` under `plugins.trusted`, so a cloned repository cannot
// enable its own plugin. Invalid manifests are rejected whole (fail closed) and
// reported through the result instead of partially applied.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { RingkoConfig } from "./config.ts";
import { loadConfig, saveConfigFile } from "./config.ts";
import type { McpServerConfig } from "./mcp.ts";
import { PLUGIN_FILE_NAME, pluginRoots, projectPluginRoots, settingsPath } from "./paths.ts";
import { isPathInside, isRecord } from "./util.ts";

const MAX_PLUGINS = 128;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_COMMANDS = 64;
const MAX_COMMAND_CHARS = 64 * 1024;
const MAX_SKILLS = 64;
const MAX_MCP_SERVERS = 64;
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMAND_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FORBIDDEN_MCP_NAMES = new Set(["__proto__", "constructor", "prototype"]);

export type PluginSource = "project" | "ringko" | "agents";
export type PluginScope = "project" | "global";

/** A prompt template exposed as a slash command. */
export interface PluginCommand {
  name: string;
  description?: string;
  /** Expanded with `$ARGUMENTS` / `{{args}}`; appended when neither appears. */
  prompt: string;
  argumentHint?: string;
}

export interface PluginManifest {
  schemaVersion?: 1;
  name: string;
  version?: string;
  description?: string;
  /** Skill directories relative to the plugin root (default: `skills`). */
  skills?: string[];
  commands?: PluginCommand[];
  /** MCP servers contributed by the plugin; explicit host config wins. */
  mcpServers?: Record<string, McpServerConfig>;
}

/** A plugin directory found on disk, before its manifest is parsed. */
export interface PluginCandidate {
  id: string;
  dir: string;
  source: PluginSource;
  scope: PluginScope;
  trusted: boolean;
}

export interface LoadedPlugin {
  /** Directory name; the trust key and command namespace. */
  id: string;
  /** Absolute plugin directory. */
  dir: string;
  manifest: PluginManifest;
  commands: readonly PluginCommand[];
  mcpServers: Readonly<Record<string, McpServerConfig>>;
  /** Absolute, contained skill directories. */
  skillDirs: readonly string[];
  source: PluginSource;
  scope: PluginScope;
}

export interface PluginLoadError {
  /** Manifest path, or `"plugins"` for a trust configuration error. */
  source: string;
  message: string;
}

export interface LoadPluginsResult {
  plugins: LoadedPlugin[];
  errors: PluginLoadError[];
}

export interface LoadPluginsOptions {
  env?: NodeJS.ProcessEnv;
  /** Workspace used to locate project plugins. */
  cwd?: string;
  /** Explicit trust list; defaults to the user-level settings file. */
  trusted?: readonly string[];
}

function fail(message: string): never {
  throw new TypeError(message);
}

function readTrusted(options: LoadPluginsOptions): string[] {
  let raw: unknown;
  if (options.trusted !== undefined) raw = options.trusted;
  else {
    const config: RingkoConfig = loadConfig({ ...(options.env ? { env: options.env } : {}) });
    raw = config.plugins?.trusted;
  }
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail("Plugin trust must be an array of plugin names.");
  return raw.filter((name): name is string => typeof name === "string" && PLUGIN_ID.test(name));
}

function parseManifest(id: string, raw: unknown): PluginManifest {
  if (!isRecord(raw)) fail("Plugin manifest must be a JSON object.");
  const allowed = new Set(["schemaVersion", "name", "version", "description", "skills", "commands", "mcpServers"]);
  for (const key of Object.keys(raw)) {
    if (key === "hooks") fail("Plugin hooks are not supported; use a runtime contribution instead.");
    if (!allowed.has(key)) fail(`Unknown plugin field "${key}".`);
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) fail("Unsupported plugin schemaVersion; expected 1.");
  if (typeof raw.name !== "string" || raw.name !== id) fail(`Plugin name must match its directory (expected "${id}").`);
  if (raw.version !== undefined && (typeof raw.version !== "string" || raw.version.length > 64)) fail("Plugin version must be a string of at most 64 characters.");
  if (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.length > 1024)) fail("Plugin description must be a string of at most 1024 characters.");

  const skills = raw.skills;
  if (skills !== undefined && (!Array.isArray(skills) || skills.length > MAX_SKILLS)) fail(`Plugin skills must be an array of at most ${String(MAX_SKILLS)} paths.`);

  const commands: PluginCommand[] = [];
  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands) || raw.commands.length > MAX_COMMANDS) fail(`Plugin commands must be an array of at most ${String(MAX_COMMANDS)} entries.`);
    const names = new Set<string>();
    for (const [index, entry] of raw.commands.entries()) {
      if (!isRecord(entry)) fail(`Plugin command ${String(index)} must be an object.`);
      for (const key of Object.keys(entry)) if (!["name", "description", "prompt", "argumentHint"].includes(key)) fail(`Unknown plugin command field "${key}".`);
      if (typeof entry.name !== "string" || !COMMAND_NAME.test(entry.name)) fail(`Invalid plugin command name at index ${String(index)}.`);
      if (names.has(entry.name)) fail(`Duplicate plugin command "${entry.name}".`);
      names.add(entry.name);
      if (typeof entry.prompt !== "string" || entry.prompt.trim().length === 0 || entry.prompt.length > MAX_COMMAND_CHARS) fail(`Plugin command "${entry.name}" requires a prompt of at most 64 KiB.`);
      if (entry.description !== undefined && (typeof entry.description !== "string" || entry.description.length > 200)) fail(`Plugin command "${entry.name}" description must be at most 200 characters.`);
      if (entry.argumentHint !== undefined && (typeof entry.argumentHint !== "string" || entry.argumentHint.length > 64)) fail(`Plugin command "${entry.name}" argumentHint must be at most 64 characters.`);
      commands.push({
        name: entry.name,
        prompt: entry.prompt,
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.argumentHint !== undefined ? { argumentHint: entry.argumentHint } : {}),
      });
    }
  }

  const mcpServers: Record<string, McpServerConfig> = {};
  if (raw.mcpServers !== undefined) {
    if (!isRecord(raw.mcpServers)) fail("Plugin mcpServers must be an object.");
    const entries = Object.entries(raw.mcpServers);
    if (entries.length > MAX_MCP_SERVERS) fail(`Plugin mcpServers must contain at most ${String(MAX_MCP_SERVERS)} entries.`);
    for (const [name, config] of entries) {
      if (!MCP_NAME.test(name) || FORBIDDEN_MCP_NAMES.has(name)) fail(`Invalid plugin MCP server name "${name}".`);
      if (!isRecord(config)) fail(`Plugin MCP server "${name}" must be an object.`);
      mcpServers[name] = config as McpServerConfig;
    }
  }

  return {
    name: id,
    ...(raw.schemaVersion !== undefined ? { schemaVersion: 1 as const } : {}),
    ...(raw.version !== undefined ? { version: raw.version } : {}),
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    ...(skills !== undefined ? { skills: skills as string[] } : {}),
    commands,
    mcpServers,
  };
}

function readManifest(id: string, dir: string): PluginManifest {
  const path = join(dir, PLUGIN_FILE_NAME);
  let stat;
  try { stat = statSync(path); } catch { fail("Plugin manifest cannot be read."); }
  if (!stat.isFile()) fail("Plugin manifest must be a regular file.");
  if (stat.size > MAX_MANIFEST_BYTES) fail("Plugin manifest exceeds 256 KiB.");
  const descriptor = openSync(path, "r");
  try {
    const current = fstatSync(descriptor);
    if (!current.isFile() || current.size > MAX_MANIFEST_BYTES) fail("Plugin manifest must be a regular file no larger than 256 KiB.");
    const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_MANIFEST_BYTES) fail("Plugin manifest exceeds 256 KiB.");
    let parsed: unknown;
    try { parsed = JSON.parse(buffer.subarray(0, total).toString("utf8")); }
    catch (error) { fail(`Plugin manifest is not valid JSON: ${(error as Error).message}`); }
    return parseManifest(id, parsed);
  } finally { closeSync(descriptor); }
}

/** Resolve declared skill directories, rejecting absolute and escaping paths. */
function resolveSkillDirs(dir: string, manifest: PluginManifest): string[] {
  const root = realpathSync(dir);
  const declared = manifest.skills;
  if (declared !== undefined) {
    for (const entry of declared) {
      if (typeof entry !== "string" || entry.length === 0 || entry.length > 256 || entry.includes("\0")) fail("Plugin skill paths must be non-empty relative strings.");
      if (isAbsolute(entry)) fail(`Plugin skill path "${entry}" must be relative.`);
      if (entry.split(/[\\/]/).some(segment => segment === "..")) fail(`Plugin skill path "${entry}" escapes the plugin directory.`);
    }
  }
  const candidates = declared ?? ["skills"];
  const out: string[] = [];
  for (const entry of candidates) {
    const target = resolve(dir, entry);
    if (!isPathInside(dir, target)) fail(`Plugin skill path "${entry}" escapes the plugin directory.`);
    if (!existsSync(target)) {
      if (declared === undefined) continue;
      fail(`Plugin skill directory "${entry}" does not exist.`);
    }
    if (!statSync(target).isDirectory()) {
      if (declared === undefined) continue;
      fail(`Plugin skill path "${entry}" is not a directory.`);
    }
    const real = realpathSync(target);
    if (!isPathInside(root, real)) fail(`Plugin skill path "${entry}" escapes the plugin directory.`);
    out.push(real);
  }
  return out;
}

function collectCandidates(env: NodeJS.ProcessEnv, cwd: string, trusted: ReadonlySet<string>): PluginCandidate[] {
  const roots: { dir: string; source: PluginSource; scope: PluginScope }[] = [
    ...projectPluginRoots(cwd, env).map(dir => ({ dir, source: "project" as const, scope: "project" as const })),
    ...pluginRoots(env).map((dir, index) => ({ dir, source: index === 0 ? "ringko" as const : "agents" as const, scope: "global" as const })),
  ];
  const found = new Map<string, PluginCandidate>();
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root.dir).sort();
    } catch {
      continue;
    }
    for (const id of entries) {
      if (!PLUGIN_ID.test(id) || found.has(id)) continue;
      const dir = join(root.dir, id);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      found.set(id, { id, dir, source: root.source, scope: root.scope, trusted: trusted.has(id) });
    }
  }
  return [...found.values()];
}

/** List plugin directories (trusted and untrusted) without parsing manifests. */
export function discoverPluginCandidates(options: LoadPluginsOptions = {}): { candidates: PluginCandidate[]; errors: PluginLoadError[] } {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  let trusted: Set<string>;
  try { trusted = new Set(readTrusted(options)); }
  catch (error) {
    return { candidates: [], errors: [{ source: "plugins", message: error instanceof Error ? error.message : "Invalid plugin trust configuration." }] };
  }
  return { candidates: collectCandidates(env, cwd, trusted), errors: [] };
}

/**
 * Discover trusted plugins. Untrusted directories are ignored; a trusted
 * plugin with an invalid manifest contributes nothing and yields one error.
 */
export function loadPlugins(options: LoadPluginsOptions = {}): LoadPluginsResult {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const errors: PluginLoadError[] = [];
  let trusted: Set<string>;
  try { trusted = new Set(readTrusted(options)); }
  catch (error) {
    errors.push({ source: "plugins", message: error instanceof Error ? error.message : "Invalid plugin trust configuration." });
    return { plugins: [], errors };
  }
  if (trusted.size === 0) return { plugins: [], errors };

  const found = new Map<string, LoadedPlugin>();
  let seen = 0;
  for (const candidate of collectCandidates(env, cwd, trusted)) {
    if (!candidate.trusted) continue;
    if (++seen > MAX_PLUGINS) {
      errors.push({ source: candidate.dir, message: `Plugin limit of ${String(MAX_PLUGINS)} reached.` });
      return { plugins: [...found.values()], errors };
    }
    try {
      const manifest = readManifest(candidate.id, candidate.dir);
      found.set(candidate.id, {
        id: candidate.id,
        dir: realpathSync(candidate.dir),
        manifest,
        commands: manifest.commands ?? [],
        mcpServers: manifest.mcpServers ?? {},
        skillDirs: resolveSkillDirs(candidate.dir, manifest),
        source: candidate.source,
        scope: candidate.scope,
      });
    } catch (error) {
      errors.push({ source: join(candidate.dir, PLUGIN_FILE_NAME), message: error instanceof Error ? error.message : "Invalid plugin." });
    }
  }
  return { plugins: [...found.values()], errors };
}

/**
 * Persist the user-level trust list while preserving every other settings key.
 * Callers must validate the plugin before adding it.
 */
export function savePluginTrust(names: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  const unique = [...new Set(names)];
  for (const name of unique) if (!PLUGIN_ID.test(name)) throw new TypeError(`Invalid plugin name "${name}".`);
  const path = settingsPath(env);
  let settings: Record<string, unknown> = {};
  try {
    const text = readFileSync(path, "utf8");
    if (text.trim().length > 0) {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new TypeError(`Settings "${path}" must be a JSON object.`);
      settings = parsed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (settings.plugins !== undefined && !isRecord(settings.plugins)) throw new TypeError('Settings field "plugins" must be an object.');
  const plugins = settings.plugins ?? {};
  return saveConfigFile({ ...settings, plugins: { ...plugins, trusted: unique } } as RingkoConfig, path);
}

/** Expand a plugin command prompt. Arguments are appended when no slot exists. */
export function expandCommandPrompt(prompt: string, argument: string): string {
  const args = argument.trim();
  const replaced = prompt.replaceAll("$ARGUMENTS", args).replaceAll("{{args}}", args);
  if (args.length === 0 || prompt.includes("$ARGUMENTS") || prompt.includes("{{args}}")) return replaced;
  return `${replaced}\n\n${args}`;
}
