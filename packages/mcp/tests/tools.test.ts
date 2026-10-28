import { expect, it } from "bun:test";
import { mcpPermissions, mcpToolDefinitions, type McpConnection } from "../src/index.ts";

function connection(local: boolean): McpConnection {
  return {
    name: "fixture",
    local,
    endpoint: "https://fixture.example/mcp",
    serverInfo: {},
    client: {} as McpConnection["client"],
    tools: [
      { name: "read_only", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "unknown" , inputSchema: { type: "object" } },
    ],
  };
}

it("does not trust remote read-only hints without host authorization", () => {
  expect(mcpToolDefinitions(connection(false), { mode: "read-only" })).toEqual([]);
  expect(mcpToolDefinitions(connection(false), { mode: "workspace-write" })).toEqual([]);
  const permissions = { fixture: { url: "https://fixture.example/mcp", readOnlyTools: ["read_only"], allowedTools: ["unknown"] } };
  expect(mcpToolDefinitions(connection(false), { mode: "read-only", permissions }).map(tool => tool.name)).toEqual(["fixture__read_only"]);
  expect(mcpToolDefinitions(connection(false), { mode: "workspace-write", permissions }).map(tool => tool.name)).toEqual(["fixture__read_only", "fixture__unknown"]);
  expect(mcpToolDefinitions({ ...connection(false), endpoint: "https://foreign.example/mcp" }, { mode: "workspace-write", permissions })).toEqual([]);
});

it("requires a matching local process boundary and never reuses a writable process for read-only", () => {
  expect(mcpToolDefinitions(connection(true), { mode: "workspace-write" })).toEqual([]);
  const writable = { ...connection(true), sandboxMode: "workspace-write" as const };
  expect(mcpToolDefinitions(writable, { mode: "read-only" })).toEqual([]);
  expect(mcpToolDefinitions(writable, { mode: "workspace-write" })).toHaveLength(2);
  expect(mcpToolDefinitions({ ...writable, sandboxMode: "read-only" }, { mode: "read-only" })).toHaveLength(2);
  expect(mcpToolDefinitions(connection(true), { mode: "danger-full-access" })).toHaveLength(2);
});

it("rejects malformed or wildcard host tool permissions", () => {
  for (const value of [false, [], { typo: [] }, { allowedTools: ["*"] }, { readOnlyTools: [42] }]) {
    expect(() => mcpPermissions(value)).toThrow();
  }
});

it("rechecks MCP authorization at execution after a tool was registered", async () => {
  const permissions: Record<string, unknown> = { fixture: { url: "https://fixture.example/mcp", readOnlyTools: ["read_only"] } };
  const definition = mcpToolDefinitions(connection(false), { mode: "read-only", permissions })[0]!;
  permissions.fixture = undefined;
  await expect(definition.execute({})).rejects.toThrow("Sandbox policy denies");
});
