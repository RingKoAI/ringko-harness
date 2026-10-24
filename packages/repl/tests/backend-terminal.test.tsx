import { expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render } from "./render.ts";
import { BackendClient, type SessionSnapshot } from "@ringko-ai/client";
import { Repl } from "../src/app.tsx";

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
