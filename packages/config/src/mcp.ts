// MCP server configuration from the user-level `.mcp.json` files.
//
// Files are read from `~/.ringko/.mcp.json` and `~/.agents/.mcp.json` (ringko
// first). Each is an object with an `mcpServers` map. A missing file is skipped;
// a present but invalid file is a hard error so misconfiguration is not hidden.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { agentsRoot, mcpPaths, ringkoRoot } from "./paths.ts";

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

export interface McpServer {
  name: string;
  config: McpServerConfig;
  source: "ringko" | "agents";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface LoadMcpServersOptions {
  env?: NodeJS.ProcessEnv;
}

/** Load and merge MCP servers (ringko-specific entries win on name). */
export function loadMcpServers(options: LoadMcpServersOptions = {}): McpServer[] {
  const env = options.env ?? process.env;
  const paths = mcpPaths(env);
  const sources = [ringkoRoot(env), agentsRoot(env)];

  const found = new Map<string, McpServer>();
  paths.forEach((path, index) => {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return; // missing file: skip
    }
    if (text.trim().length === 0) return; // empty placeholder file: skip

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`MCP file "${path}" is not valid JSON: ${(error as Error).message}`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`MCP file "${path}" must be a JSON object.`);
    }
    const servers = parsed.mcpServers;
    if (servers === undefined) return;
    if (!isRecord(servers)) {
      throw new Error(`MCP file "${path}" field "mcpServers" must be an object.`);
    }

    const source: McpServer["source"] = path.startsWith(sources[0]) ? "ringko" : "agents";
    for (const [name, config] of Object.entries(servers)) {
      if (!isRecord(config)) {
        throw new Error(`MCP server "${name}" in "${path}" must be an object.`);
      }
      if (!found.has(name)) {
        found.set(name, { name, config: config as McpServerConfig, source });
      }
    }
  });

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
