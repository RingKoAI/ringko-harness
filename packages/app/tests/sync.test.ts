import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { BackendClient, BackendError, consumeSse, type SessionSnapshot } from "@ringko-ai/client";
import { startServer } from "../src/server.ts";

const TOKEN = "isolated-fixture-token";
function completion(content: string, calls: Array<{ id: string; name: string; arguments: unknown }> = [], usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details: { cached_tokens: number } }): Response {
  const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return new Response(frame({ role: "assistant", content, ...(calls.length ? { tool_calls: calls.map((call, index) => ({ index, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }, null) + frame({}, calls.length ? "tool_calls" : "stop") + (usage ? `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage })}\n\n` : "") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
async function eventually<T>(read: () => Promise<T>, check: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await Bun.sleep(20); }
  throw new Error("Timed out waiting for synchronized state.");
}
function fixture(handler: (request: Request) => Response | Promise<Response>) {
  const root = mkdtempSync(join(tmpdir(), "rkh-sync-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  saveConfig({ model: "Fixture/fixture", providers: [{ name: "Fixture", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "fixture", name: "Fixture" }] }], permission: "approval", capabilities: { shell: true } });
  const app = startServer({ workspace: root, port: 0, shared: true, authToken: TOKEN });
  const client = () => new BackendClient({ url: app.url, token: TOKEN, workspace: root });
  return { root, app, client, close() { app.stop(); provider.stop(true); if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; rmSync(root, { recursive: true, force: true }); } };
}

it("two clients synchronize a detached run and reject concurrent writes/deletion", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const setup = fixture(async () => { await gate; return completion("shared result"); });
  const left = setup.client(), right = setup.client();
  const snapshots: SessionSnapshot[] = [];
  let first: { close(): void } | undefined, second: { close(): void } | undefined;
  try {
    const session = await left.createSession();
    first = left.watchSession(session.id, value => snapshots.push(value));
    second = right.watchSession(session.id, value => snapshots.push(value));
    expect(await left.run({ sessionId: session.id, prompt: "shared prompt" })).toEqual({ sessionId: session.id });
    const busy = await eventually(() => right.snapshot(session.id), value => value.busy && value.messages.some(message => message.content === "shared prompt"));
    expect(busy.busy).toBe(true);
    await expect(right.run({ sessionId: session.id, prompt: "must not overlap" })).rejects.toBeInstanceOf(BackendError);
    const deletion = await fetch(`${setup.app.url}/api/sessions/${session.id}`, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(deletion.status).toBe(409);
    first.close(); // Closing one terminal never cancels the backend's run.
    release();
    await eventually(() => right.snapshot(session.id), value => !value.busy && value.messages.some(message => message.content === "shared result"));
    await eventually(async () => snapshots, values => values.some(value => !value.busy && value.messages.some(message => message.content === "shared result")));
    expect((await left.snapshot(session.id)).messages).toEqual((await right.snapshot(session.id)).messages);
  } finally { release(); first?.close(); second?.close(); setup.close(); }
});

it("cancelling the original streaming HTTP reader does not abort execution", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const setup = fixture(async () => { await gate; return completion("survived disconnect"); });
  try {
    const client = setup.client(); const session = await client.createSession();
    const response = await fetch(`${setup.app.url}/api/chat`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ sessionId: session.id, prompt: "disconnect fixture" }) });
    const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
    expect((await client.snapshot(session.id)).busy).toBe(true);
    release();
    const completed = await eventually(() => client.snapshot(session.id), value => !value.busy);
    expect(completed.messages.some(message => message.content === "survived disconnect")).toBe(true);
  } finally { release(); setup.close(); }
});

it("late attach receives pending approvals and only one client can settle them", async () => {
  let turns = 0;
  const setup = fixture(() => ++turns === 1 ? completion("", [{ id: "command", name: "shell", arguments: { command: "echo approval-fixture" } }]) : completion("approval finished"));
  try {
    const left = setup.client(), right = setup.client(); const session = await left.createSession();
    await left.run({ sessionId: session.id, prompt: "request a shell approval" });
    const pending = await eventually(() => right.snapshot(session.id), value => value.approvals.length > 0);
    expect(pending.approvals[0].riskKind).toBe("shell");
    const decisions = await Promise.allSettled([left.request("/api/approval", { id: pending.approvals[0].id, approved: false }), right.request("/api/approval", { id: pending.approvals[0].id, approved: false })]);
    expect(decisions.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const completed = await eventually(() => right.snapshot(session.id), value => !value.busy);
    expect(completed.approvals).toEqual([]);
    expect(completed.messages.some(message => message.content === "approval finished")).toBe(true);
  } finally { setup.close(); }
}, 10_000);

it("sync/snapshot endpoints enforce authentication, origin and workspace boundaries", async () => {
  const setup = fixture(() => completion("unused"));
  try {
    const session = await setup.client().createSession();
    for (const path of ["/api/sync", "/api/backend", `/api/sessions/${session.id}/snapshot`]) expect((await fetch(`${setup.app.url}${path}`)).status).toBe(401);
    expect((await fetch(`${setup.app.url}/api/runs`, { method: "POST", headers: { origin: "https://attacker.invalid", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ sessionId: session.id, prompt: "forbidden" }) })).status).toBe(403);
    expect((await fetch(`${setup.app.url}/api/sessions`, { headers: { authorization: `Bearer ${TOKEN}`, "x-ringko-workspace": "%broken" } })).status).toBe(400);
    expect((await fetch(`${setup.app.url}/api/sessions`, { headers: { authorization: `Bearer ${TOKEN}`, "x-ringko-workspace": encodeURIComponent(join(setup.root, "other")) } })).status).toBe(409);
    expect((await fetch(`${setup.app.url}/api/sessions/%ZZ/snapshot`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(400);
  } finally { setup.close(); }
});

it("streams provider-reported usage and restores the same session totals through snapshots", async () => {
  const setup = fixture(async request => {
    const body = await request.json();
    return JSON.stringify(body).includes("label an agent conversation") ? completion("metadata unavailable") : completion("usage reply", [], { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 60 } });
  });
  try {
    const client = setup.client(); const session = await client.createSession();
    const response = await fetch(`${setup.app.url}/api/chat`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ sessionId: session.id, prompt: "usage fixture" }) });
    const seen: unknown[] = [];
    await consumeSse(response, (event, data) => { if (event === "usage") seen.push(data); });
    expect(seen).toContainEqual({ usage: { calls: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 60, cacheWriteTokens: null, cacheHitRate: 0.6, cacheReportedCalls: 1, partial: false } });
    expect((await client.snapshot(session.id)).usage).toMatchObject({ totalTokens: 120, cacheHitRate: 0.6 });
  } finally { setup.close(); }
});
