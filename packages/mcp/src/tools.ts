// Expose a connected MCP server's tools as harness tools (approval-gated).
import { defineTool, ToolRegistry, type AnyToolDefinition, type RiskKind } from "@ringko-ai/harness";
import { writeDiagnostic } from "@ringko-ai/config";
import type { McpConnection } from "./client.ts";
import { mcpPermissions, mcpToolAuthorized } from "./policy.ts";

const INVALID = /[^a-zA-Z0-9_-]/g;

function segment(value: string): string {
  return value.replace(INVALID, "_");
}

export interface RegisterMcpOptions {
  /** Approval risk kind for every tool (default "network"). */
  risk?: RiskKind;
  /** Active host policy; authority comes from confined processes or operator configuration. */
  mode?: "read-only" | "workspace-write" | "danger-full-access";
  permissions?: Readonly<Record<string, unknown>>;
}

/** Build harness tool definitions for one connected server. */
export function mcpToolDefinitions(connection: McpConnection, options: RegisterMcpOptions = {}): AnyToolDefinition[] {
  const prefix = segment(connection.name).slice(0, 40) || "mcp";
  const risk: RiskKind = options.risk ?? "network";
  const mode = options.mode ?? "workspace-write";
  const authorized = (name: string) => mcpToolAuthorized(connection, name, mode, connection.local ? undefined : mcpPermissions(options.permissions?.[connection.name]));
  return connection.tools.filter((tool) => {
    if (authorized(tool.name)) return true;
    writeDiagnostic(`mcp.${connection.name}`, `Tool ${tool.name} is withheld under ${mode}: no matching host authorization or process boundary.`);
    return false;
  }).map((tool) => {
    const name = `${prefix}__${segment(tool.name)}`.slice(0, 128);
    return defineTool<Record<string, unknown>, string>({
      name,
      description: tool.description?.trim() || `MCP tool "${tool.name}" from server "${connection.name}".`,
      inputSchema: tool.inputSchema,
      parseInput(value) {
        if (value === undefined || value === null) return {};
        if (typeof value !== "object" || Array.isArray(value)) {
          throw new TypeError(`Tool "${name}" expects an object input.`);
        }
        return value as Record<string, unknown>;
      },
      assessRisk() {
        return {
          kind: risk,
          reason: `Call MCP tool ${connection.name}/${tool.name}.`,
          target: `${connection.name}/${tool.name}`,
        };
      },
      async execute(input) {
        if (!authorized(tool.name)) throw new Error(`Sandbox policy denies MCP tool ${connection.name}/${tool.name}.`);
        return await connection.client.callTool(tool.name, input);
      },
    });
  });
}

/** Register every connected server's tools; returns the registered names. */
export function registerMcpTools(
  registry: ToolRegistry,
  connections: readonly McpConnection[],
  options: RegisterMcpOptions = {},
): string[] {
  const registered: string[] = [];
  for (const connection of connections) {
    for (const definition of mcpToolDefinitions(connection, options)) {
      if (registry.has(definition.name)) continue;
      registry.register(definition);
      registered.push(definition.name);
    }
  }
  return registered;
}



