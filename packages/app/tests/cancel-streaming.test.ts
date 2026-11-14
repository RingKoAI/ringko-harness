import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { BackendClient, consumeSse } from "@ringko-ai/client";
import { startServer } from "../src/server.ts";

const frame = (delta: unknown, finish: string | null): string =>
  `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

it("cancellation keeps streamed text, reports no error and lets the next turn continue", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-cancel-text-")), previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  const gate = Promise.withResolvers<void>();
  let turns = 0;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { messages: unknown[] };
    if (JSON.stringify(body).includes("label an agent conversation")) return new Response(frame({ role: "assistant", content: "Fixture" }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    turns += 1;
    if (turns === 1) return new Response(new ReadableStream({ async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(frame({ role: "assistant", content: "Streamed prefix survives" }, null)));
      await gate.promise;
      controller.enqueue(encoder.encode(frame({ role: "assistant", content: " and this is dropped" }, null) + frame({}, "stop") + "data: [DONE]\n\n"));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
    return new Response(frame({ role: "assistant", content: "second turn ok" }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  saveConfig({ model: "Fixture/fixture", providers: [{ name: "Fixture", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "fixture", name: "Fixture" }] }], permission: "full", capabilities: { shell: false, network: false } });
  const app = startServer({ workspace: root, port: 0, shared: true });
  try {
    const client = new BackendClient({ url: app.url, workspace: root });
    const session = await client.createSession();
    const events: string[] = [];
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-ringko-workspace": encodeURIComponent(root) }, body: JSON.stringify({ sessionId: session.id, prompt: "start writing" }) });
    const streaming = consumeSse(response, event => {
      events.push(event);
      if (event === "delta") void client.stop(session.id);
    });
    const deadline = Date.now() + 10_000;
    while (!events.includes("cancelled") && Date.now() < deadline) await Bun.sleep(20);
    gate.resolve();
    await streaming;
    expect(events).toContain("cancelled");
    expect(events).not.toContain("error");
    expect(events.indexOf("delta")).toBeLessThan(events.indexOf("cancelled"));

    const cancelled = await client.snapshot(session.id);
    expect(cancelled.busy).toBe(false);
    expect(cancelled.error).toBeNull();
    expect(cancelled.partial).toBeNull();
    expect(cancelled.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual(["Streamed prefix survives"]);
    expect(cancelled.events.filter(event => event.type.startsWith("run/")).map(event => event.type)).toEqual(["run/started", "run/cancelled"]);
    expect(cancelled.events.some(event => event.type === "tool/call")).toBe(false);

    await client.run({ sessionId: session.id, prompt: "continue" });
    const deadline2 = Date.now() + 10_000;
    while ((await client.snapshot(session.id)).busy && Date.now() < deadline2) await Bun.sleep(20);
    const continued = await client.snapshot(session.id);
    expect(continued.error).toBeNull();
    expect(continued.messages.filter(message => message.role === "user").map(message => message.content)).toEqual(["start writing", "continue"]);
    expect(continued.messages.some(message => message.role === "assistant" && message.content.includes("second turn ok"))).toBe(true);
  } finally { gate.resolve(); await app.stop(); provider.stop(true); if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; rmSync(root, { recursive: true, force: true }); }
}, 30_000);
