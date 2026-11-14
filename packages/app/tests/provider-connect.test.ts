import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApiKey, loadConfig, saveConfig, saveConfigFile } from "@ringko-ai/config";
import { startServer } from "../src/server.ts";

it("authenticates provider connection, keeps secrets in auth storage and respects explicit config", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-connect-api-")), previous = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  const path = join(root, "explicit.json"); saveConfig({ providers: [] }); saveConfigFile({ providers: [], permission: "approval" }, path);
  let broken = false, discoveries = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    discoveries++; expect(new URL(request.url).pathname).toBe("/v1/models"); expect(request.headers.get("authorization")).toBeNull();
    return broken ? Response.json({ error: "private-api-key" }, { status: 401 }) : Response.json({ data: [{ id: "gemini-4-argon", name: "Gemini 4 Argon" }] });
  } });
  const server = startServer({ workspace: root, shared: true, port: 0, authToken: "backend-token", configPath: path });
  const body = { name: "opencode-go", type: "opencode-go", baseURL: `http://127.0.0.1:${upstream.port}/openai/v1`, apiKey: "private-api-key" };
  const post = (value: unknown, headers: Record<string, string> = {}) => fetch(`${server.url}/api/providers/connect`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
  const headers = { authorization: "Bearer backend-token" };
  try {
    expect((await post(body)).status).toBe(401); expect((await post(body, { ...headers, origin: "https://foreign.example" })).status).toBe(403);
    expect((await post({ ...body, name: "__proto__" }, headers)).status).toBe(400); expect(discoveries).toBe(0);
    expect((await post({ ...body, name: "missing", apiKey: "", modelIds: ["model"] }, headers)).status).toBe(400); expect(discoveries).toBe(0);
    const response = await post(body, headers), text = await response.text(); expect(response.status).toBe(200); expect(text).not.toContain("private-api-key");
    expect(getApiKey(body.name)).toBe(body.apiKey); expect(readFileSync(path, "utf8")).not.toContain(body.apiKey);
    expect(loadConfig({ path }).providers?.[0]?.models?.[0]?.id).toBe("gemini-4-argon"); expect(loadConfig().providers).toEqual([]);
    broken = true; const failed = await post({ ...body, name: "failed" }, headers); expect(failed.status).toBe(502); expect(await failed.text()).not.toContain(body.apiKey);
    expect(getApiKey("failed")).toBeUndefined(); expect(loadConfig({ path }).providers).toHaveLength(1);
  } finally {
    await server.stop(); upstream.stop(true);
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
});
