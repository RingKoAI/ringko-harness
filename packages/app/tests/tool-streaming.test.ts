import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { BackendClient, consumeSse } from "@ringko-ai/client";
import { startServer } from "../src/server.ts";

/** OpenAI-compatible SSE: tool arguments arrive as fragments, then the final call. */
function frame(delta: unknown, finish: string | null): string {
  return `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}
function streamedToolCall(): Response {
  const text = frame({ role: "assistant", content: "Reading now" }, null)
    + frame({ tool_calls: [{ index: 0, id: "call-read", type: "function", function: { name: "read", arguments: '{"path":' } }] }, null)
    + frame({ tool_calls: [{ index: 0, function: { arguments: '"AGENTS.md"}' } }] }, null)
    + frame({}, "tool_calls") + "data: [DONE]\n\n";
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

it("streams tool arguments to clients before the validated call runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-tool-stream-")), previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  writeFileSync(join(root, "AGENTS.md"), "fixture instructions");
  let turns = 0;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { messages: Array<{ role: string; content?: unknown }> };
    const metadata = JSON.stringify(body).includes("label an agent conversation");
    if (metadata) return new Response(frame({ role: "assistant", content: "Fixture" }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    turns += 1;
    if (turns === 1) return streamedToolCall();
    const tool = body.messages.findLast(message => message.role === "tool");
    return new Response(frame({ role: "assistant", content: `read result: ${JSON.stringify(tool?.content).slice(0, 40)}` }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  saveConfig({ model: "Fixture/fixture", providers: [{ name: "Fixture", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "fixture", name: "Fixture" }] }], permission: "full", capabilities: { shell: false, network: false } });
  const app = startServer({ workspace: root, port: 0, shared: true, managed: false });
  try {
    const client = new BackendClient({ url: app.url, workspace: root });
    const events: Array<{ event: string; data: unknown }> = [];
    const session = await client.createSession();
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-ringko-workspace": encodeURIComponent(root) }, body: JSON.stringify({ sessionId: session.id, prompt: "read the rules" }) });
    await consumeSse(response, (event, data) => { if (["session", "delta", "tool_input", "assistant", "tool", "done", "error"].includes(event)) events.push({ event, data }); });
    const tools = events.filter(entry => entry.event === "tool_input");
    expect(tools.length).toBeGreaterThanOrEqual(3);
    expect(tools[0]).toMatchObject({ data: { kind: "start", name: "read" } });
    expect(tools.some(entry => (entry.data as { kind: string }).kind === "end")).toBe(true);
    const startIndex = events.indexOf(tools[0]!), tokenIndex = events.findIndex(entry => entry.event === "tool");
    expect(startIndex).toBeLessThan(tokenIndex);
    expect(events.filter(entry => entry.event === "error")).toEqual([]);
    expect((await client.snapshot(session.id)).messages.some(message => message.role === "tool" && String(message.content).includes("fixture instructions"))).toBe(true);
  } finally { await app.stop(); provider.stop(true); if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; rmSync(root, { recursive: true, force: true }); }
}, 30_000);
