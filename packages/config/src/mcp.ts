// MCP server configuration from the user-level `.mcp.json` files.
//
// Files are read from `~/.ringko/.mcp.json` and `~/.agents/.mcp.json` (ringko
// first). Each is an object with an `mcpServers` map. A missing file is skipped;
// a present but invalid file is a hard error so misconfiguration is not hidden.
import { readFileSync } from "node:fs";
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
