import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { startServer } from "../src/server.ts";

function completion(model: string, content: string): Response {
  const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return new Response(frame({ role: "assistant", content }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

it("runs a self-referential loop over the chat stream until the completion promise", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-loop-api-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  let runs = 0;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { model: string; messages: Array<{ role: string; content: string }> };
    if (body.model === "small") return completion("small", "session");
    runs += 1;
    return completion("parent", runs < 2 ? "still working" : "all good <promise>DONE</promise>");
  } });
  let app: ReturnType<typeof startServer> | undefined;
  try {
    saveConfig({ model: "Mock/parent", small_model: "Mock/small", providers: [{ name: "Mock", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "parent", name: "Parent" }, { id: "small", name: "Small" }] }] });
    app = startServer({ workspace: root, port: 0, authToken: "fixture-token" });
    const headers = { authorization: "Bearer fixture-token", "content-type": "application/json" };
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ prompt: "/loop fix it", loop: { args: "fix it --completion-promise DONE --max-iterations 5" } }) });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    let buffer = "";
    const loopIterations: number[] = [];
    let done: { content: string } | undefined;
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      buffer += new TextDecoder().decode(next.value);
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const type = frame.split("\n")[0].slice(7);
        const data = JSON.parse(frame.split("\n")[1].slice(6));
        if (type === "loop") loopIterations.push(data.iteration);
        if (type === "done") done = data;
        if (type === "error") throw new Error(data.message);
        index = buffer.indexOf("\n\n");
      }
    }
    expect(loopIterations).toEqual([1, 2]);
    expect(runs).toBe(2);
    expect(done?.content).toContain("<promise>DONE</promise>");
    expect((await fetch(`${app.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ prompt: "/loop x", loop: { args: "--max-iterations nope" } }) })).status).toBe(400);
  } finally {
    app?.stop(); provider.stop(true);
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
