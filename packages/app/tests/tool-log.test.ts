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
    } finally {
      server?.stop();
      if (previousHome === undefined) delete process.env.RINGKO_HOME;
      else process.env.RINGKO_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
