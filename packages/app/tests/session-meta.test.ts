import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, recordSessionSummary, recordSessionTitle, recordUserMessage } from "@ringko-ai/session";
import { startServer } from "../src/server.ts";

it("exposes a session's title and summary in the list and detail endpoints", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-session-meta-"));
  const previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore({ cwd: workspace });
  const session = store.create({ id: "meta-one" });
  recordUserMessage(session, "Fix the login redirect");
  recordSessionTitle(session, "Fix login redirect");
  recordSessionSummary(session, "Patched the OAuth callback and added a regression test.");
  session.flush();
  session.close();

  const app = startServer({ workspace, port: 0 });
  try {
    const list = await (await fetch(`${app.url}/api/sessions`)).json() as Array<{ id: string; title: string | null; summary: string | null }>;
    expect(list).toContainEqual({
      id: "meta-one",
      createdAt: expect.any(Number),
      cwd: workspace,
      title: "Fix login redirect",
      summary: "Patched the OAuth callback and added a regression test.",
      archived: false,
    });
    const detail = await (await fetch(`${app.url}/api/sessions/meta-one`)).json();
    expect(detail).toMatchObject({
      title: "Fix login redirect",
      summary: "Patched the OAuth callback and added a regression test.",
    });
  } finally {
    app.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
