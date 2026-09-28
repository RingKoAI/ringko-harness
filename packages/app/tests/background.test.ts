import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { startServer } from "../src/server.ts";

function completion(model: string, content: string, calls: Array<{ id: string; name: string; arguments: unknown }> = [], stream = true): Response {
  if (stream) {
    const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    return new Response(frame({ role: "assistant", content, ...(calls.length ? { tool_calls: calls.map((call, index) => ({ index, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }, null) + frame({}, calls.length ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }
  return Response.json({ id: "fixture", object: "chat.completion", created: 1, model, choices: [{ index: 0, message: { role: "assistant", content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }, finish_reason: calls.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
}

it("serves ask answers, todo persistence, sub/shell subscriptions and parent continuation", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-background-api-"));
  const previousHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  let childDone!: () => void;
  const child = new Promise<void>(resolve => { childDone = resolve; });
  let turns = 0;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { model: string; messages: unknown[] };
    if (body.model === "child") { await child; return completion("child", "child findings", [], false); }
    if (++turns === 1) return completion("parent", "", [
      { id: "ask", name: "ask", arguments: { questions: [{ id: "scope", question: "Which scope?", options: [{ label: "Auth" }, { label: "All" }] }] } },
      { id: "todo", name: "todowrite", arguments: { todos: [{ content: "Review auth", status: "in_progress" }] } },
      { id: "sub", name: "task", arguments: { description: "Inspect auth", prompt: "Inspect auth", mode: "read", model: "Mock/child" } },
      { id: "shell", name: "shell", arguments: { command: "echo fixture-output", background: true } },
    ]);
    return completion("parent", turns === 2 ? "Parent continued" : "Final reviewed child findings");
  } });
  let app: ReturnType<typeof startServer> | undefined;
  try {
    saveConfig({ model: "Mock/parent", providers: [{ name: "Mock", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "parent", name: "Parent" }, { id: "child", name: "Child" }] }], mode: "full", capabilities: { shell: true } });
    app = startServer({ workspace: root, port: 0, authToken: "fixture-token" });
    const headers = { authorization: "Bearer fixture-token", "content-type": "application/json" };
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ prompt: "Delegate and ask" }) });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(); let buffer = "", session = "", sawOutput = false, sawDone = false, sawDelta = false;
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      buffer += new TextDecoder().decode(next.value);
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const type = frame.split("\n")[0].slice(7); const data = JSON.parse(frame.split("\n")[1].slice(6));
        if (type === "session") {
          session = data.sessionId;
          expect((await fetch(`${app!.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ sessionId: session, prompt: "Must not overlap" }) })).status).toBe(409);
        }
        if (type === "delta") sawDelta = true;
        if (type === "ask") {
          expect((await fetch(`${app!.url}/api/ask`, { method: "POST", headers, body: JSON.stringify({ id: data.id, output: { answers: [{ id: "scope", selected: ["Invalid"] }] } }) })).status).toBe(400);
          expect((await fetch(`${app!.url}/api/ask`, { method: "POST", headers, body: JSON.stringify({ id: data.id, output: { answers: [{ id: "scope", selected: ["Auth"] }] } }) })).status).toBe(200);
        }
        if (type === "job" && data.kind === "sub" && data.type === "started") {
          const eventsUrl = `${app!.url}/api/sessions/${session}/events?jobId=${data.jobId}&after=-1`;
          expect((await fetch(eventsUrl)).status).toBe(401);
          expect((await (await fetch(eventsUrl, { headers })).json()).events[0].type).toBe("started");
          expect((await fetch(`${app!.url}/api/sessions/${session}/jobs`, { method: "POST", headers, body: JSON.stringify({ jobId: data.jobId, action: "background" }) })).status).toBe(200);
        }
        if (type === "job" && data.kind === "shell" && data.type === "stdout") sawOutput = JSON.stringify(data.data).includes("fixture-output");
        if (type === "assistant" && data.content === "Parent continued") childDone();
        if (type === "error") throw new Error(data.message);
        if (type === "done") { expect(data.content).toBe("Final reviewed child findings"); sawDone = true; }
        index = buffer.indexOf("\n\n");
      }
    }
    expect(sawDone).toBe(true); expect(sawOutput).toBe(true); expect(sawDelta).toBe(true);
    const detail = await (await fetch(`${app.url}/api/sessions/${session}`, { headers })).json();
    expect(detail.todos).toEqual([{ content: "Review auth", status: "in_progress" }]);
    expect(detail.tasks).toMatchObject([{ mode: "read", model: "Mock/child", status: "completed" }]);
    expect(detail.jobs).toHaveLength(2);
    const taskUrl = `${app.url}/api/sessions/${session}/task-detail?taskId=${detail.tasks[0].taskId}`;
    expect((await fetch(taskUrl)).status).toBe(401);
    const taskDetail = await (await fetch(taskUrl, { headers })).json();
    expect(taskDetail.records.some((record: { data: { event?: { message?: { content: string } } } }) => record.data.event?.message?.content === "child findings")).toBe(true);
    expect((await fetch(`${app.url}/api/workspace/files`)).status).toBe(401);
    expect((await fetch(`${app.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ prompt: 123 }) })).status).toBe(400);
    expect(detail.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content.includes("Background job notifications"))).toBe(true);
  } finally {
    childDone(); app?.stop(); provider.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

it("stops a running background child and persists cancellation before closing the session", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-stop-api-"));
  const previousHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  let release!: () => void;
  const pendingChild = new Promise<void>(resolve => { release = resolve; });
  let turns = 0;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { model: string };
    if (body.model === "child") { await pendingChild; return completion("child", "late findings", [], false); }
    return ++turns === 1 ? completion("parent", "", [{ id: "delegate", name: "task", arguments: { description: "Inspect", prompt: "Inspect", mode: "read", model: "Mock/child", background: true } }]) : completion("parent", "Waiting for child");
  } });
  let app: ReturnType<typeof startServer> | undefined;
  try {
    saveConfig({ model: "Mock/parent", providers: [{ name: "Mock", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "parent", name: "Parent" }, { id: "child", name: "Child" }] }] });
    app = startServer({ workspace: root, port: 0, authToken: "fixture-token" });
    const headers = { authorization: "Bearer fixture-token", "content-type": "application/json" };
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ prompt: "Delegate" }) });
    const reader = response.body!.getReader(); let buffer = "", session = "", stopped = false;
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      buffer += new TextDecoder().decode(next.value);
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const type = frame.split("\n")[0].slice(7); const data = JSON.parse(frame.split("\n")[1].slice(6));
        if (type === "session") session = data.sessionId;
        if (type === "job" && data.type === "started" && !stopped) {
          expect((await fetch(`${app!.url}/api/sessions/${session}/stop`, { method: "POST", headers })).status).toBe(200);
          stopped = true;
        }
        index = buffer.indexOf("\n\n");
      }
    }
    expect(stopped).toBe(true);
    const detail = await (await fetch(`${app.url}/api/sessions/${session}`, { headers })).json();
    expect(detail.tasks).toMatchObject([{ status: "cancelled" }]);
    expect(detail.jobs).toMatchObject([{ status: "cancelled" }]);
    expect(detail.messages.some((message: { content: string }) => message.content === "late findings")).toBe(false);
  } finally {
    release(); app?.stop(); provider.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
