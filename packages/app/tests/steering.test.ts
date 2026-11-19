import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { BackendClient, consumeSse } from "@ringko-ai/client";
import { startServer } from "../src/server.ts";

const frame = (delta: unknown, finish: string | null): string =>
  `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

it("steers a running session mid-turn, exposes pending steering in snapshot, and persists the interjection", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-app-steer-")), previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  const holdFirstTurn = Promise.withResolvers<void>();
  const firstDeltaSent = Promise.withResolvers<void>();
  const seenModelUsers: string[][] = [];
  let modelCalls = 0;

  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = await request.json() as { messages: Array<{ role: string; content: unknown }> };
      if (JSON.stringify(body).includes("label an agent conversation")) {
        return new Response(frame({ role: "assistant", content: "Steer Test" }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      modelCalls += 1;
      seenModelUsers.push(body.messages.filter(m => m.role === "user").map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
      if (modelCalls === 1) {
        return new Response(new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(frame({ role: "assistant", content: "Working on step 1" }, null)));
            firstDeltaSent.resolve();
            await holdFirstTurn.promise;
            controller.enqueue(encoder.encode(frame({}, "stop") + "data: [DONE]\n\n"));
            controller.close();
          },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      return new Response(frame({ role: "assistant", content: "Final reply with BANANA" }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });

  saveConfig({
    model: "Fixture/fixture",
    providers: [{ name: "Fixture", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "fixture", name: "Fixture" }] }],
    permission: "full",
    capabilities: { shell: false, network: false },
  });

  const app = startServer({ workspace: root, port: 0, shared: true });
  try {
    const client = new BackendClient({ url: app.url, workspace: root });

    // UI busyEnter preference round-trip and validation
    const updatedInfo = await client.request<{ busyEnter: string }>("/api/ui", { busyEnter: "steer" });
    expect(updatedInfo.busyEnter).toBe("steer");
    await expect(client.request("/api/ui", { busyEnter: "invalid" })).rejects.toThrow(/busyEnter/);

    const session = await client.createSession();
    // Steering an idle session returns 409
    await expect(client.steer(session.id, { prompt: "too early" })).rejects.toThrow(/No active run/);

    const sseEvents: Array<{ event: string; data: unknown }> = [];
    const response = await fetch(`${app.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ringko-workspace": encodeURIComponent(root) },
      body: JSON.stringify({ sessionId: session.id, prompt: "Start step 1" }),
    });
    const streaming = consumeSse(response, (event, data) => {
      sseEvents.push({ event, data });
    });

    await firstDeltaSent.promise;
    const steerAck = await client.steer(session.id, { id: "steer-msg-1", prompt: "Include BANANA" });
    expect(steerAck).toEqual({ ok: true, id: "steer-msg-1" });

    // While step 1 is held open, snapshot exposes pending steering
    const midSnapshot = await client.snapshot(session.id);
    expect(midSnapshot.busy).toBe(true);
    expect(midSnapshot.steering).toEqual([{ id: "steer-msg-1", content: "Include BANANA" }]);

    holdFirstTurn.resolve();
    await streaming;

    const eventNames = sseEvents.map(item => item.event);
    expect(eventNames).toContain("steering");
    expect(eventNames).toContain("user");
    expect(eventNames).toContain("done");
    expect(eventNames.indexOf("steering")).toBeLessThan(eventNames.indexOf("user"));
    expect(eventNames.indexOf("user")).toBeLessThan(eventNames.indexOf("done"));

    const finalSnapshot = await client.snapshot(session.id);
    expect(finalSnapshot.busy).toBe(false);
    expect(finalSnapshot.steering).toEqual([]);
    expect(finalSnapshot.messages.map(m => [m.role, m.content])).toEqual([
      ["user", "Start step 1"],
      ["assistant", "Working on step 1"],
      ["user", "Include BANANA"],
      ["assistant", "Final reply with BANANA"],
    ]);
    expect(seenModelUsers).toEqual([
      ["Start step 1"],
      ["Start step 1", "Include BANANA"],
    ]);
  } finally {
    holdFirstTurn.resolve();
    await app.stop();
    provider.stop(true);
    if (previous === undefined) delete process.env.RINGKO_HOME;
    else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
