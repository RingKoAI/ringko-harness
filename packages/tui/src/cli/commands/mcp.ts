import {
  loadMcpServerMap,
  loadMcpServers,
  saveMcpServers,
  type McpServerConfig,
} from "@ringko-ai/config";
import type { CliIo, ParsedArgs } from "../types.ts";

export function mcpCommand(parsed: ParsedArgs, io: CliIo): number {
  const [sub, name, ...rest] = parsed.positionals;
  if (sub === "set") {
    if (!name || rest.length === 0) {
      io.err("mcp set requires <name> <json-config>.");
      return 2;
    }
    let config: unknown;
    try {
      config = JSON.parse(rest.join(" "));
    } catch {
      io.err("MCP config must be valid JSON.");
      return 2;
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      io.err("MCP config must be a JSON object.");
      return 2;
    }
    try {
      const map = loadMcpServerMap();
      map[name] = config as McpServerConfig;
      saveMcpServers(map);
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot save MCP configuration.");
      return 1;
    }
    io.out(`saved MCP server ${name}.`);
    return 0;
  }
  if (sub === "remove") {
    if (!name) {
      io.err("mcp remove requires <name>.");
      return 2;
    }
    try {
      const map = loadMcpServerMap();
      if (!(name in map)) {
        io.err(`unknown MCP server "${name}".`);
        return 1;
      }
      delete map[name];
      saveMcpServers(map);
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot save MCP configuration.");
      return 1;
    }
    io.out(`removed MCP server ${name}.`);
    return 0;
  }
  let servers;
  try {
    servers = loadMcpServers();
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid MCP configuration.");
    return 2;
  }
  for (const server of servers) {
    const kind = server.config.url ? "http" : "stdio";
    io.out(`${server.name}\t${server.source}\t${kind}`);
  }
  return 0;
}
