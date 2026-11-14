import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { BackendClient, consumeSse } from "@ringko-ai/client";
import { startServer } from "../src/server.ts";

it("keeps a first message and a durable failed session when the real instruction directory limit is reached", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-failed-session-")), previous = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  const workspace = join(root, "project"), bulk = join(workspace, "bulk");
  mkdirSync(join(workspace, ".git"), { recursive: true }); mkdirSync(bulk); writeFileSync(join(workspace, "AGENTS.md"), "Fixture project policy");
  const EXCESS_DIRECTORIES = 4097;
  for (let index = 0; index < EXCESS_DIRECTORIES; index++) mkdirSync(join(bulk, String(index)));
  saveConfig({ providers: [], capabilities: { shell: false, network: false } });
  let server = startServer({ workspace, shared: true, port: 0 });
  const prompt = "Preserve this first failed message";
  try {
    const response = await fetch(`${server.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
    let id: string | undefined, failure: string | undefined;
    await consumeSse(response, (event, data) => { if (event === "session") id = (data as { sessionId: string }).sessionId; if (event === "error") failure = (data as { message: string }).message; });
    expect(failure).toContain("Instruction scan exceeds the directory limit"); expect(failure).toContain("narrower workspace"); expect(id).toBeDefined();
    const client = new BackendClient({ url: server.url, workspace });
    const failed = await client.snapshot(id!); expect(failed.busy).toBe(false); expect(failed.messages.filter(message => message.role === "user").map(message => message.content)).toEqual([prompt]);
    expect((await client.sessions()).find(session => session.id === id)?.title).toBe(prompt);
    expect(failed.events.filter(event => event.type.startsWith("run/")).map(event => event.type)).toEqual(["run/started", "run/failed"]);
    await server.stop(); server = startServer({ workspace, shared: true, port: 0 });
    const restoredClient = new BackendClient({ url: server.url, workspace });
    expect((await restoredClient.snapshot(id!)).messages[0]?.content).toBe(prompt);
    rmSync(bulk, { recursive: true, force: true }); await restoredClient.run({ sessionId: id!, prompt: "Retry after repair" });
    const end = Date.now() + 5000;
    while ((await restoredClient.snapshot(id!)).busy && Date.now() < end) await Bun.sleep(20);
    const recovered = await restoredClient.snapshot(id!); expect(recovered.busy).toBe(false); expect(recovered.error).toBeNull();
    expect(recovered.messages.filter(message => message.role === "user").map(message => message.content)).toEqual([prompt, "Retry after repair"]);
    expect(recovered.messages.some(message => message.role === "assistant" && message.content === "echo: Retry after repair")).toBe(true);
  } finally {
    await server.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("journals the first input when agent construction fails before SDK invocation", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-failed-agent-")), previous = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  saveConfig({ providers: [], permission: "invalid-permission" });
  const server = startServer({ workspace: root, shared: true, port: 0 });
  try {
    const response = await fetch(`${server.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Keep input after constructor failure" }) });
    let id: string | undefined;
    await consumeSse(response, (event, data) => { if (event === "session") id = (data as { sessionId: string }).sessionId; });
    expect(id).toBeDefined();
    const snapshot = await new BackendClient({ url: server.url, workspace: root }).snapshot(id!);
    expect(snapshot.messages[0]?.content).toBe("Keep input after constructor failure"); expect(snapshot.busy).toBe(false);
    expect(snapshot.events.filter(event => event.type.startsWith("run/")).map(event => event.type)).toEqual(["run/started", "run/failed"]);
  } finally {
    await server.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
});
