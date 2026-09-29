import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionManager } from "../../sdk/src/permissions.ts";
import { startServer } from "../src/server.ts";

it("lists and removes only saved workspace rules through authenticated API", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-permission-api-"));
  const previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  const workspace = join(root, "workspace");
  const manager = new PermissionManager(workspace);
  const rule = { tool: "shell", target: "echo fixture", behavior: "allow" as const };
  manager.add("first", rule, "saved");
  const app = startServer({ workspace, port: 0, authToken: "fixture-token" });
  try {
    const endpoint = `${app.url}/api/permissions`;
    const headers = { authorization: "Bearer fixture-token", "content-type": "application/json" };
    expect((await fetch(endpoint)).status).toBe(401);
    expect((await (await fetch(endpoint, { headers })).json()).rules).toEqual([rule]);
    expect((await fetch(endpoint, { method: "DELETE", headers, body: JSON.stringify({ workspace: "wrong", ...rule }) })).status).toBe(409);
    expect((await fetch(endpoint, { method: "DELETE", headers, body: JSON.stringify({ workspace, ...rule, target: "other" }) })).status).toBe(404);
    expect((await fetch(endpoint, { method: "DELETE", headers, body: JSON.stringify({ workspace, tool: "shell", behavior: "invalid" }) })).status).toBe(400);
    expect(manager.list("first", "saved")).toEqual([rule]);
    expect((await fetch(endpoint, { method: "DELETE", headers, body: JSON.stringify({ workspace, ...rule }) })).status).toBe(200);
    expect((await (await fetch(endpoint, { headers })).json()).rules).toEqual([]);
  } finally {
    app.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
