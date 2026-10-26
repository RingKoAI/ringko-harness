import { expect, it } from "bun:test";
import { mcpToolDefinitions, type McpConnection } from "../src/index.ts";

function connection(local: boolean): McpConnection {
  return {
    name: "fixture",
    local,
    serverInfo: {},
    client: {} as McpConnection["client"],
    tools: [
      { name: "read_only", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "unknown" , inputSchema: { type: "object" } },
    ],
  };
}

it("withholds undeclared remote tools only under read-only", () => {
  expect(mcpToolDefinitions(connection(false), { mode: "read-only" }).map(tool => tool.name)).toEqual(["fixture__read_only"]);
  expect(mcpToolDefinitions(connection(false), { mode: "workspace-write" }).map(tool => tool.name)).toEqual(["fixture__read_only", "fixture__unknown"]);
  expect(mcpToolDefinitions(connection(true), { mode: "read-only" }).map(tool => tool.name)).toEqual(["fixture__read_only", "fixture__unknown"]);
});
