import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { startServer } from "../src/server.ts";

function completion(model: string, content: string, calls: Array<{ id: string; name: string; arguments: unknown }> = []): Response {
  const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return new Response(frame({ role: "assistant", content, ...(calls.length ? { tool_calls: calls.map((call, index) => ({ index, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }, null) + frame({}, calls.length ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

it("cancels a running delegated task through the job control endpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-task-cancel-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  let releaseChild!: () => void;
  const childGate = new Promise<void>(resolve => { releaseChild = resolve; });
  let turns = 0;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { model: string };
    if (body.model === "child") { await childGate; return completion("child", "late child result"); }
    return ++turns === 1
      ? completion("parent", "", [{ id: "delegate", name: "task", arguments: { description: "Inspect auth", prompt: "Inspect auth", mode: "read", model: "Mock/child" } }])
      : completion("parent", "Parent continued after cancel");
  } });
  let app: ReturnType<typeof startServer> | undefined;
  try {
    saveConfig({ model: "Mock/parent", providers: [{ name: "Mock", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "parent", name: "Parent" }, { id: "child", name: "Child" }] }], mode: "full" });
    app = startServer({ workspace: root, port: 0, authToken: "fixture-token" });
    const headers = { authorization: "Bearer fixture-token", "content-type": "application/json" };
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ prompt: "Delegate then cancel" }) });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    let buffer = "", session = "";
    let taskId = "";
    let cancelledStatus: string | undefined;
    let done = false;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      buffer += new TextDecoder().decode(next.value);
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const type = frame.split("\n")[0].slice(7);
        const data = JSON.parse(frame.split("\n")[1].slice(6));
        if (type === "session") session = data.sessionId;
        if (type === "task" && data.type === "started" && !taskId) {
          taskId = data.taskId;
          const cancelUrl = `${app.url}/api/sessions/${session}/task-cancel`;
          expect((await fetch(cancelUrl, { method: "POST", headers, body: JSON.stringify({}) })).status).toBe(400);
          expect((await fetch(cancelUrl, { method: "POST", headers, body: JSON.stringify({ taskId: "missing-task" }) })).status).toBe(404);
          const action = await fetch(cancelUrl, { method: "POST", headers, body: JSON.stringify({ taskId }) });
          expect(action.status).toBe(200);
          expect(await action.json()).toEqual({ ok: true });
        }
        if (type === "task" && data.type === "cancelled") cancelledStatus = data.reason ?? "cancelled";
        if (type === "done") done = true;
        if (type === "error") throw new Error(data.message);
        index = buffer.indexOf("\n\n");
      }
    }
    expect(taskId).not.toBe("");
    expect(cancelledStatus).toBe("cancelled");
    expect(done).toBe(true);
    const detail = await (await fetch(`${app.url}/api/sessions/${session}`, { headers })).json();
    expect(detail.tasks).toMatchObject([{ taskId, status: "cancelled" }]);
    expect(detail.messages.some((message: { content: string }) => message.content === "late child result")).toBe(false);
  } finally {
    releaseChild();
    app?.stop(); provider.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("stops the whole run while a delegated task is still executing", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-run-stop-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  let releaseChild!: () => void;
  const childGate = new Promise<void>(resolve => { releaseChild = resolve; });
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { model: string };
    if (body.model === "child") { await childGate; return completion("child", "late child result"); }
    return completion("parent", "", [{ id: "delegate", name: "task", arguments: { description: "Slow inspect", prompt: "Inspect", mode: "read", model: "Mock/child" } }]);
  } });
  let app: ReturnType<typeof startServer> | undefined;
  try {
    saveConfig({ model: "Mock/parent", providers: [{ name: "Mock", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "parent", name: "Parent" }, { id: "child", name: "Child" }] }], mode: "full" });
    app = startServer({ workspace: root, port: 0, authToken: "fixture-token" });
    const headers = { authorization: "Bearer fixture-token", "content-type": "application/json" };
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ prompt: "Delegate then stop the run" }) });
    const reader = response.body!.getReader();
    let buffer = "", session = "", taskId = "", stopped = false;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      buffer += new TextDecoder().decode(next.value);
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const type = frame.split("\n")[0].slice(7);
        const data = JSON.parse(frame.split("\n")[1].slice(6));
        if (type === "session") session = data.sessionId;
        if (type === "task" && data.type === "started" && !stopped) {
          taskId = data.taskId;
          expect((await fetch(`${app.url}/api/sessions/${session}/stop`, { method: "POST", headers })).status).toBe(200);
          stopped = true;
        }
        index = buffer.indexOf("\n\n");
      }
    }
    expect(stopped).toBe(true);
    const detail = await (await fetch(`${app.url}/api/sessions/${session}`, { headers })).json();
    expect(detail.tasks).toMatchObject([{ taskId, status: "cancelled" }]);
    expect(detail.messages.some((message: { content: string }) => message.content === "late child result")).toBe(false);
  } finally {
    releaseChild();
    app?.stop(); provider.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
