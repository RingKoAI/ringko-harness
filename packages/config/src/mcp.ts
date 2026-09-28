// MCP server configuration from the user-level `.mcp.json` files.
//
// Files are read from `~/.ringko/.mcp.json` and `~/.agents/.mcp.json` (ringko
// first). Each is an object with an `mcpServers` map. A missing file is skipped;
// a present but invalid file is a hard error so misconfiguration is not hidden.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentsRoot, findProjectRoot, mcpPaths, projectMcpPaths, ringkoRoot } from "./paths.ts";

export interface McpServerConfig {
  /** stdio transport command. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Remote transport URL. */
  url?: string;
  type?: string;
  [key: string]: unknown;
}

export type McpScope = "project" | "global";

export interface McpServer {
  name: string;
  config: McpServerConfig;
  /** File the entry came from. */
  source: "project" | "ringko" | "agents";
  /** Project-level vs user-level. */
  scope: McpScope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface LoadMcpServersOptions {
  env?: NodeJS.ProcessEnv;
  /** Workspace used to locate a project root. */
  cwd?: string;
}

/**
 * Load and merge MCP servers. Project-level entries (`<root>/.mcp.json`,
 * `<root>/ringko.json`) win, then the user-level `~/.ringko` then `~/.agents`.
 */
export function loadMcpServers(options: LoadMcpServersOptions = {}): McpServer[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const entries: { path: string; source: McpServer["source"]; scope: McpScope }[] = [
    ...projectMcpPaths(cwd, env).map((path) => ({ path, source: "project" as const, scope: "project" as const })),
    ...mcpPaths(env).map((path, index) => ({
      path,
      source: index === 0 ? ("ringko" as const) : ("agents" as const),
      scope: "global" as const,
    })),
  ];

  const found = new Map<string, McpServer>();
  for (const entry of entries) {
    let text: string;
    try {
      text = readFileSync(entry.path, "utf8");
    } catch {
      continue; // missing file: skip
    }
    if (text.trim().length === 0) continue; // empty placeholder file: skip

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`MCP file "${entry.path}" is not valid JSON: ${(error as Error).message}`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`MCP file "${entry.path}" must be a JSON object.`);
    }
    const servers = parsed.mcpServers;
    if (servers === undefined) continue;
    if (!isRecord(servers)) {
      throw new Error(`MCP file "${entry.path}" field "mcpServers" must be an object.`);
    }

    for (const [name, config] of Object.entries(servers)) {
      if (!isRecord(config)) {
        throw new Error(`MCP server "${name}" in "${entry.path}" must be an object.`);
      }
      if (!found.has(name)) {
        found.set(name, { name, config: config as McpServerConfig, source: entry.source, scope: entry.scope });
      }
    }
  }

  return [...found.values()];
}

export type McpServerMap = Record<string, McpServerConfig>;

/** Read the ringko-level `.mcp.json` server map alone (no merge). */
export function loadMcpServerMap(env: NodeJS.ProcessEnv = process.env): McpServerMap {
  let text: string;
  try {
    text = readFileSync(mcpPaths(env)[0], "utf8");
  } catch {
    return {};
  }
  if (text.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`MCP file is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed) || parsed.mcpServers === undefined) return {};
  if (!isRecord(parsed.mcpServers)) throw new Error('MCP field "mcpServers" must be an object.');
  const out: McpServerMap = {};
  for (const [name, config] of Object.entries(parsed.mcpServers)) {
    if (isRecord(config)) out[name] = config as McpServerConfig;
  }
  return out;
}

/** Overwrite the ringko-level `.mcp.json` server map (written 0600). */
export function saveMcpServers(servers: McpServerMap, env: NodeJS.ProcessEnv = process.env): string {
  const path = mcpPaths(env)[0];
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
  return path;
}

/**
 * Write a project's MCP server map. Updates the project's existing `.mcp.json`
 * when present, otherwise merges `mcpServers` into `<root>/ringko.json`.
 */
export function saveProjectMcpServers(
  cwd: string,
  servers: McpServerMap,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = findProjectRoot(cwd, env);
  if (!root) throw new Error("No project root found; cannot save project MCP configuration.");
  const dotMcp = join(root, ".mcp.json");
  const ringkoJson = join(root, "ringko.json");
  const useRingkoJson = !existsSync(dotMcp);
  const target = useRingkoJson ? ringkoJson : dotMcp;

  let existing: Record<string, unknown> = {};
  if (useRingkoJson) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(target, "utf8"));
      if (isRecord(parsed)) existing = parsed;
    } catch {
      // new or invalid file: start fresh
    }
  }
  const payload = useRingkoJson ? { ...existing, mcpServers: servers } : { mcpServers: servers };
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}
