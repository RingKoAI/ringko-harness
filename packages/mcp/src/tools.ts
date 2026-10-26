// Expose a connected MCP server's tools as harness tools (approval-gated).
import { defineTool, ToolRegistry, type AnyToolDefinition, type RiskKind } from "@ringko-ai/harness";
import { writeDiagnostic } from "@ringko-ai/config";
import type { McpConnection } from "./client.ts";

const INVALID = /[^a-zA-Z0-9_-]/g;

function segment(value: string): string {
  return value.replace(INVALID, "_");
}

export interface RegisterMcpOptions {
  /** Approval risk kind for every tool (default "network"). */
  risk?: RiskKind;
  /** Active host policy; remote tools without a positive read-only declaration are withheld. */
  mode?: "read-only" | "workspace-write" | "danger-full-access";
}

/** Build harness tool definitions for one connected server. */
export function mcpToolDefinitions(connection: McpConnection, options: RegisterMcpOptions = {}): AnyToolDefinition[] {
  const prefix = segment(connection.name).slice(0, 40) || "mcp";
  const risk: RiskKind = options.risk ?? "network";
  return connection.tools.filter((tool) => {
    if (connection.local || (options.mode ?? "workspace-write") !== "read-only") return true;
    if (tool.annotations?.readOnlyHint === true) return true;
    writeDiagnostic(`mcp.${connection.name}`, `Remote tool ${tool.name} is withheld under read-only: no positive read-only declaration.`);
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



