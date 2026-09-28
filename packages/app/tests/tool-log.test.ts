import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, recordAssistantMessage, recordToolCall, recordToolResult } from "@ringko-ai/session";
import { startServer } from "../src/server.ts";

describe("session tool log API", () => {
  it("requires authorization and pages recorded calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-tool-log-api-"));
    const previousHome = process.env.RINGKO_HOME;
    process.env.RINGKO_HOME = root;
    let server: ReturnType<typeof startServer> | undefined;
    try {
      const workspace = join(root, "workspace");
      mkdirSync(workspace);
      const store = new SessionStore({ cwd: workspace });
      const session = store.create({ id: "tool-log-test" });
      recordAssistantMessage(session, 1, "", [
        { id: "a", name: "read", arguments: { path: "a.txt" } },
        { id: "b", name: "write", arguments: { path: "b.txt" } },
      ]);
      recordToolCall(session, 1, { id: "a", name: "read", arguments: { path: "a.txt" } });
      recordToolResult(session, 1, "a", "read", "contents", false);
      session.appendEvent("task/started", { taskId: "child", parentCallId: "a", description: "Inspect", mode: "read" });
      session.appendEvent("task/completed", { taskId: "child", description: "Inspect", mode: "read", result: { content: "findings" } });
      session.close();

      server = startServer({ port: 0, workspace, authToken: "test-token" });
      const url = `${server.url}/api/sessions/tool-log-test/tool-log?limit=1`;
      expect((await fetch(url)).status).toBe(401);
      const first = await fetch(url, { headers: { authorization: "Bearer test-token" } });
      expect(first.status).toBe(200);
      const page = await first.json() as { total: number; entries: Array<{ callId: string; status: string }> };
      expect(page.total).toBe(2);
      expect(page.entries).toMatchObject([{ callId: "b", status: "pending" }]);
      const second = await fetch(`${url}&offset=1`, { headers: { authorization: "Bearer test-token" } });
      expect((await second.json()).entries).toMatchObject([{ callId: "a", status: "success" }]);
      const trajectoryUrl = `${server.url}/api/sessions/tool-log-test/trajectory`;
      const headers = { authorization: "Bearer test-token" };
      expect((await fetch(trajectoryUrl)).status).toBe(401);
      const tail = await (await fetch(`${trajectoryUrl}?limit=1`, { headers })).json();
      expect(tail.records).toMatchObject([{ type: "task/completed", kind: "task" }]);
      expect(tail.hasOlder).toBe(true);
      const older = await (await fetch(`${trajectoryUrl}?before=${tail.records[0].seq}&limit=1`, { headers })).json();
      expect(older.records).toMatchObject([{ type: "task/started" }]);
      expect((await fetch(`${trajectoryUrl}?limit=999`, { headers })).status).toBe(400);
      expect((await fetch(`${trajectoryUrl}?before=1&after=0`, { headers })).status).toBe(400);
      expect((await fetch(`${trajectoryUrl}?after=`, { headers })).status).toBe(400);
      expect((await fetch(`${server.url}/api/sessions/missing/trajectory`, { headers })).status).toBe(404);
      const detail = await (await fetch(`${server.url}/api/sessions/tool-log-test`, { headers })).json();
      expect(detail.tasks).toMatchObject([{ taskId: "child", mode: "read", status: "completed", content: "findings" }]);
      const stopUrl = `${server.url}/api/sessions/tool-log-test/stop`;
      expect((await fetch(stopUrl, { method: "POST" })).status).toBe(401);
      expect((await fetch(stopUrl, { method: "POST", headers })).status).toBe(404);
    } finally {
      server?.stop();
      if (previousHome === undefined) delete process.env.RINGKO_HOME;
      else process.env.RINGKO_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
