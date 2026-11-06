import { expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render } from "./render.ts";
import { BackendClient, type SessionSnapshot } from "@ringko-ai/client";
import { Repl } from "../src/app.tsx";

it("ignores stale session refreshes and never reopens a dismissed picker", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-picker-refresh-"));
  const input = new PassThrough(), output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { columns: 100, rows: 30, isTTY: true });
  let text = ""; output.on("data", data => { text += data.toString(); });
  const requests: Array<ReturnType<typeof Promise.withResolvers<Response>>> = [];
  const watchers = new Set<Parameters<BackendClient["watch"]>[0]>();
  const backend = new BackendClient({ fetch: async url => {
    if (String(url) === "/api/sessions") {
      const pending = Promise.withResolvers<Response>(); requests.push(pending); return pending.promise;
    }
    return Response.json({ tools: [], providers: [] });
  } });
  backend.watch = listener => { watchers.add(listener); return { close: () => { watchers.delete(listener); } }; };
  let revision = 0;
  const notify = (kind: "session" | "reset" = "session") => { for (const watcher of watchers) watcher({ instance: "fixture", revision: ++revision, kind }); };
  const respond = (index: number, title: string) => requests[index]!.resolve(Response.json([{ id: "session", createdAt: 1, cwd: root, title }]));
  const app = render(<Repl backend={backend} workspace={root} model={async () => ({ content: "", toolCalls: [] })} modelLabel="Remote" config={{}} />, { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
  try {
    await Bun.sleep(100);
    input.write("\x12"); await Bun.sleep(80);
    respond(0, "Initial session"); await Bun.sleep(100);
    notify(); await Bun.sleep(40);
    notify(); await Bun.sleep(40);
    expect(requests).toHaveLength(3);
    respond(2, "Newest session"); await Bun.sleep(100);
    text = "";
    respond(1, "Stale session"); await Bun.sleep(100);
    expect(text).not.toContain("Stale session");
    notify(); await Bun.sleep(40);
    input.write("\x1b"); await Bun.sleep(100);
    text = "";
    respond(3, "Reopened session"); await Bun.sleep(100);
    expect(text).not.toContain("Select a session");
    expect(text).not.toContain("Reopened session");
    input.write("\x12"); await Bun.sleep(80);
    respond(4, "Initial session"); await Bun.sleep(100);
    notify("reset"); await Bun.sleep(40);
    expect(requests).toHaveLength(6);
    respond(5, "[*] Literal title"); await Bun.sleep(100);
    text = "";
    input.write("\x12"); await Bun.sleep(100);
    expect(text).toContain("[*] Literal title");
  } finally {
    app.unmount();
    for (const pending of requests) pending.resolve(Response.json([]));
    input.destroy(); output.destroy(); rmSync(root, { recursive: true, force: true });
  }
});

it("keeps the session picker open after deleting a session", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-remote-delete-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  const input = new PassThrough(), output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { columns: 100, rows: 30, isTTY: true });
  let text = ""; output.on("data", data => { text += data.toString(); });
  let sessions = [
    { id: "extra1", createdAt: 1, cwd: root, title: "Extra 1" },
    { id: "extra2", createdAt: 2, cwd: root, title: "Extra 2" },
    { id: "active", createdAt: 3, cwd: root, title: "Active" },
  ];
  const deleted: string[] = [];
  const snapshot: SessionSnapshot = { id: "active", instance: "fixture", revision: 0, title: null, summary: null, archived: false, messages: [], events: [], busy: false, approvals: [], questions: [], tasks: [], todos: [], jobs: [], partial: null, loop: null, error: null };
  const backend = new BackendClient({ fetch: async (url, init) => {
    const path = String(url);
    if (path === "/api/sessions" && init?.method === "POST") return Response.json(sessions.find(session => session.id === "active"));
    if (path === "/api/sessions") return Response.json(sessions);
    if (path === "/api/sessions/active/snapshot") return Response.json(snapshot);
    if (path === "/api/info") return Response.json({ model: "Remote model", modelId: "Remote/model", thinking: "high", expandThinking: false, expandTools: false, tools: ["read"], providers: [] });
    if (path === "/api/sync") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: sync\ndata: {"instance":"fixture","revision":0,"kind":"reset"}\n\n')); } }));
    if (init?.method === "DELETE" && path.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(path.slice("/api/sessions/".length));
      deleted.push(id);
      sessions = sessions.filter(session => session.id !== id);
      return Response.json({ ok: true });
    }
    return Response.json({ error: `Unexpected request ${path}` }, { status: 400 });
  } });
  const app = render(<Repl backend={backend} resumeSessionId="active" workspace={root} model={async () => ({ content: "", toolCalls: [] })} modelLabel="Remote model" config={{}} />, { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
  try {
    await Bun.sleep(250);
    input.write("\x12"); await Bun.sleep(150);
    expect(text).toContain("Select a session");
    input.write("\x04"); await Bun.sleep(200);
    expect(deleted).toEqual(["extra1"]);
    expect(text).toContain("Select a session");
    expect(text).toContain("Extra 2");
    input.write("\x04"); await Bun.sleep(200);
    expect(deleted).toEqual(["extra1", "extra2"]);
    expect(text).toContain("Select a session");
    input.write("\x04"); await Bun.sleep(150);
    expect(text).toContain("cannot delete the active session.");
    expect(deleted).toEqual(["extra1", "extra2"]);
  } finally {
    app.unmount(); input.destroy(); output.destroy();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

it("creates the backend session from the first prompt instead of on mount", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-lazy-session-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  const input = new PassThrough(), output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { columns: 100, rows: 30, isTTY: true });
  let creates = 0;
  const runs: Array<{ sessionId?: string; prompt: string }> = [];
  const selected: Array<string | undefined> = [];
  const snapshot: SessionSnapshot = { id: "seeded", instance: "fixture", revision: 0, title: null, summary: null, archived: false, messages: [], events: [], busy: false, approvals: [], questions: [], tasks: [], todos: [], jobs: [], partial: null, loop: null, error: null };
  const backend = new BackendClient({ fetch: async (url, init) => {
    const path = String(url);
    if (path === "/api/sessions" && init?.method === "POST") { creates += 1; return Response.json({ id: "empty" }); }
    if (path === "/api/sessions") return Response.json([]);
    if (path === "/api/info") return Response.json({ model: "Remote model", modelId: "Remote/model", thinking: "high", expandThinking: false, expandTools: false, tools: ["read"], providers: [] });
    if (path === "/api/sync") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: sync\ndata: {"instance":"fixture","revision":0,"kind":"reset"}\n\n')); } }));
    if (path === "/api/runs" && init?.method === "POST") {
      runs.push(JSON.parse(String(init.body)) as { sessionId?: string; prompt: string });
      return Response.json({ sessionId: "seeded" }, { status: 202 });
    }
    if (path === "/api/sessions/seeded/snapshot") return Response.json(snapshot);
    return Response.json({ error: `Unexpected request ${path}` }, { status: 400 });
  } });
  const app = render(<Repl backend={backend} onSession={id => selected.push(id)} workspace={root} model={async () => ({ content: "", toolCalls: [] })} modelLabel="Remote model" config={{}} />, { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
  try {
    await Bun.sleep(250);
    expect(creates).toBe(0);
    input.write("hello"); await Bun.sleep(50); input.write("\r");
    await Bun.sleep(350);
    expect(creates).toBe(0);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.sessionId).toBeUndefined();
    expect(runs[0]?.prompt).toBe("hello");
    expect(selected).toContain("seeded");
  } finally {
    app.unmount(); input.destroy(); output.destroy();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

it("the connected terminal only uses backend sessions and detaches without cancelling runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-remote-repl-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  const input = new PassThrough(), output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { columns: 100, rows: 30, isTTY: true });
  let text = ""; output.on("data", data => { text += data.toString(); });
  let localModelCalls = 0, runRequests = 0, stopRequests = 0, detached = 0;
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const snapshot: SessionSnapshot = { id: "remote", instance: "fixture", revision: 0, title: null, summary: null, archived: false, messages: [], events: [], busy: false, approvals: [], questions: [], tasks: [], todos: [], jobs: [], partial: null, loop: null, error: null };
  const notice = () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`event: sync\ndata: ${JSON.stringify({ instance: "fixture", revision: snapshot.revision, kind: "session", sessionId: "remote" })}\n\n`)); };
  const backend = new BackendClient({ fetch: async (url, init) => {
    const path = String(url);
    if (path === "/api/sessions" && init?.method === "POST") return Response.json({ id: "remote", createdAt: 1, cwd: root });
    if (path === "/api/sessions/remote/snapshot") return Response.json(snapshot);
    if (path === "/api/info") return Response.json({ model: "Remote model", modelId: "Remote/model", thinking: "high", expandThinking: false, expandTools: false, tools: ["read"], providers: [] });
    if (path === "/api/sync") {
      let own: ReadableStreamDefaultController<Uint8Array>;
      return new Response(new ReadableStream({ start(controller) { own = controller; streams.add(controller); controller.enqueue(new TextEncoder().encode('event: sync\ndata: {"instance":"fixture","revision":0,"kind":"reset"}\n\n')); }, cancel() { streams.delete(own); detached++; } }));
    }
    if (path === "/api/runs") {
      runRequests++; snapshot.revision++; snapshot.busy = true;
      snapshot.messages = [{ role: "user", content: "hello backend" }, { role: "assistant", content: "synchronized backend answer" }]; notice();
      return Response.json({ sessionId: "remote" }, { status: 202 });
    }
    if (path.endsWith("/stop")) { stopRequests++; return Response.json({ ok: true }); }
    return Response.json({ error: `Unexpected request ${path}` }, { status: 400 });
  } });
  const app = render(<Repl backend={backend} workspace={root} model={async () => { localModelCalls++; return { content: "local", toolCalls: [] }; }} modelLabel="Remote model" config={{}} />, { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
  try {
    await Bun.sleep(250); input.write("hello backend"); await Bun.sleep(50); input.write("\r"); await Bun.sleep(300);
    expect(runRequests).toBe(1); expect(localModelCalls).toBe(0);
    expect(text).toContain("synchronized backend answer");
    expect(readdirSync(root)).toEqual([]);
    app.unmount(); await Bun.sleep(25);
    expect(detached).toBeGreaterThan(0); expect(stopRequests).toBe(0);
  } finally {
    app.unmount(); input.destroy(); output.destroy();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
