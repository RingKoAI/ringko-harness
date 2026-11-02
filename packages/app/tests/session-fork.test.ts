import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, recordAssistantMessage, recordUserMessage } from "@ringko-ai/session";
import { startServer } from "../src/server.ts";

it("forks a session through the API and rejects an unknown id", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-fork-api-"));
  const previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore({ cwd: workspace });
  const session = store.create({ id: "fork-src" });
  recordUserMessage(session, "first");
  recordUserMessage(session, "second");
  session.flush();
  session.close();

  const app = startServer({ workspace, port: 0 });
  try {
    const headers = { "content-type": "application/json" };
    expect((await fetch(`${app.url}/api/sessions/missing/fork`, { method: "POST", headers, body: "{}" })).status).toBe(404);
    const response = await fetch(`${app.url}/api/sessions/fork-src/fork`, { method: "POST", headers, body: "{}" });
    expect(response.status).toBe(200);
    const { sessionId } = await response.json() as { sessionId: string };
    expect(sessionId).toBeTruthy();
    expect(sessionId).not.toBe("fork-src");
    const detail = await (await fetch(`${app.url}/api/sessions/${sessionId}`)).json() as { messages: Array<{ content: string }> };
    expect(detail.messages.map(message => message.content)).toEqual(["first", "second"]);
  } finally {
    app.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

it("forks before a user message for editing and rejects non-user targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-fork-edit-api-"));
  const previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore({ cwd: workspace });
  const session = store.create({ id: "edit-src" });
  recordUserMessage(session, "one");
  recordUserMessage(session, "two");
  recordAssistantMessage(session, 1, "answer", []);
  session.flush();
  session.close();

  const app = startServer({ workspace, port: 0 });
  try {
    const headers = { "content-type": "application/json" };
    const before = await fetch(`${app.url}/api/sessions/edit-src/fork`, {
      method: "POST", headers, body: JSON.stringify({ index: 1, before: true }),
    });
    expect(before.status).toBe(200);
    const { sessionId } = await before.json() as { sessionId: string };
    const detail = await (await fetch(`${app.url}/api/sessions/${sessionId}`)).json() as { messages: Array<{ content: string }> };
    expect(detail.messages.map(message => message.content)).toEqual(["one"]);

    expect((await fetch(`${app.url}/api/sessions/edit-src/fork`, {
      method: "POST", headers, body: JSON.stringify({ index: 2, before: true }),
    })).status).toBe(400);
    expect((await fetch(`${app.url}/api/sessions/edit-src/fork`, {
      method: "POST", headers, body: JSON.stringify({ before: true }),
    })).status).toBe(400);
  } finally {
    app.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
