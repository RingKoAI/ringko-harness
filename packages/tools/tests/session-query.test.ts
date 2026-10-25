import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "@ringko-ai/harness";
import { SESSION_FORMAT_VERSION, SessionStore, serializeEvent, serializeHeader, sessionDir, sessionLogPath } from "@ringko-ai/session";
import { registerSessionQueryTools, SESSION_QUERY_LIMITS, type SessionListOutput, type SessionReadOutput, type SessionSearchOutput } from "../src/index.ts";

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

interface Fixture {
  workspace: string;
  store: SessionStore;
}

/** Two sessions in the workspace plus one in a different workspace. */
async function fixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "rkh-session-query-"));
  roots.push(base);
  const root = join(base, "sessions");
  const workspace = join(base, "workspace");
  const other = join(base, "other-workspace");

  const store = new SessionStore({ root, cwd: workspace });
  const first = store.create({ id: "session-a", now: 1_700_000_000_000 });
  first.appendEvent("session/title", { title: "Fix login redirect" });
  first.appendEvent("user/message", { text: "please find the alpha needle" });
  first.appendEvent("tool/result", { output: "y".repeat(5_000) });
  first.flush();
  first.close();

  const second = store.create({ id: "session-b", now: 1_700_000_100_000 });
  second.appendEvent("user/message", { text: "unrelated work" });
  second.flush();
  second.close();

  const foreign = new SessionStore({ root, cwd: other });
  const elsewhere = foreign.create({ id: "session-other", now: 1_700_000_200_000 });
  elsewhere.appendEvent("user/message", { text: "other workspace secret" });
  elsewhere.flush();
  elsewhere.close();

  return { workspace, store };
}

function registryFor(fixtureValue: Fixture, limits: Partial<typeof SESSION_QUERY_LIMITS> = {}): ToolRegistry {
  const registry = new ToolRegistry();
  registerSessionQueryTools(registry, { workspace: fixtureValue.workspace, store: fixtureValue.store, limits });
  return registry;
}

describe("registerSessionQueryTools", () => {
  it("registers the read-only history tools with read task access", () => {
    const registry = registryFor({ workspace: "/tmp/workspace", store: new SessionStore({ root: "/tmp/none" }) });
    expect(registry.names()).toEqual(["session_list", "session_search", "session_read"]);
    for (const name of ["session_list", "session_search", "session_read"]) {
      expect(registry.get(name)?.taskAccess).toBe("read");
    }
  });

  it("lists only the sessions of the registered workspace, newest first", async () => {
    const fixtureValue = await fixture();
    const listed = await registryFor(fixtureValue).call("session_list", {}) as SessionListOutput;

    expect(listed.workspace).toBe(fixtureValue.workspace);
    expect(listed.sessions.map(session => session.id)).toEqual(["session-b", "session-a"]);
    expect(listed.sessions[1]?.title).toBe("Fix login redirect");
    expect(listed.truncated).toBe(false);
  });

  it("honours the list limit", async () => {
    const fixtureValue = await fixture();
    const listed = await registryFor(fixtureValue).call("session_list", { limit: 1 }) as SessionListOutput;

    expect(listed.sessions.map(session => session.id)).toEqual(["session-b"]);
    expect(listed.truncated).toBe(true);
  });

  it("searches recorded events and never reaches another workspace", async () => {
    const fixtureValue = await fixture();
    const registry = registryFor(fixtureValue);

    const found = await registry.call("session_search", { query: "ALPHA needle" }) as SessionSearchOutput;
    expect(found.matches).toHaveLength(1);
    expect(found.matches[0]).toMatchObject({ session: "session-a", seq: 1, type: "user/message" });
    expect(found.matches[0]?.snippet).toContain("alpha needle");
    expect(found.scanned.sessions).toBe(2);

    const foreign = await registry.call("session_search", { query: "secret" }) as SessionSearchOutput;
    expect(foreign.matches).toEqual([]);
    await expect(registry.call("session_search", { query: "other workspace", session: "session-other" })).rejects.toThrow("No session");
  });

  it("reads events by cursor and marks truncated data", async () => {
    const fixtureValue = await fixture();
    const registry = registryFor(fixtureValue);

    const whole = await registry.call("session_read", { session: "session-a" }) as SessionReadOutput;
    expect(whole.events.map(event => event.type)).toEqual(["session/title", "user/message", "tool/result"]);
    expect(whole.hasOlder).toBe(false);
    expect(whole.hasNewer).toBe(false);
    expect(whole.events[2]?.dataTruncated).toBe(true);
    expect(whole.events[2]?.dataText?.endsWith("…")).toBe(true);
    expect(whole.events[0]?.dataTruncated).toBe(false);
    expect(whole.session.title).toBe("Fix login redirect");

    const tail = await registry.call("session_read", { session: "session-a", limit: 2 }) as SessionReadOutput;
    expect(tail.events.map(event => event.seq)).toEqual([1, 2]);
    expect(tail.hasOlder).toBe(true);

    const after = await registry.call("session_read", { session: "session-a", after: 0 }) as SessionReadOutput;
    expect(after.events.map(event => event.seq)).toEqual([1, 2]);
    expect(after.hasOlder).toBe(false);
    expect(after.hasNewer).toBe(false);
  });

  it("rejects unknown sessions, oversized logs and mixed cursors", async () => {
    const fixtureValue = await fixture();
    const registry = registryFor(fixtureValue);

    await expect(registry.call("session_read", { session: "session-missing" })).rejects.toThrow("No session");
    await expect(registry.call("session_read", { session: "session-a", before: 2, after: 0 })).rejects.toThrow("not both");
    await expect(registryFor(fixtureValue, { sessionBytes: 8 }).call("session_read", { session: "session-a" })).rejects.toThrow("too large");
    await expect(registry.call("session_search", { query: "" })).rejects.toThrow();
    await expect(registry.call("session_list", { limit: 0 })).rejects.toThrow();
  });

  it("bounds the response and reports truncation", async () => {
    const fixtureValue = await fixture();
    const bounded = registryFor(fixtureValue, { responseCharacters: 40 });
    const read = await bounded.call("session_read", { session: "session-a" }) as SessionReadOutput;
    expect(read.truncated).toBe(true);
    expect(read.events.length).toBeLessThan(3);

    const registry = registryFor(fixtureValue);
    const search = await registry.call("session_search", { query: "needle" }) as SessionSearchOutput;
    expect(search.truncated).toBe(false);
    expect(search.matches).toHaveLength(1);
  });

  it("ignores a log whose recorded cwd differs from this workspace", async () => {
    const base = await mkdtemp(join(tmpdir(), "rkh-session-forged-"));
    roots.push(base);
    const root = join(base, "sessions");
    const workspace = join(base, "workspace");
    const elsewhere = join(base, "elsewhere");
    const dir = sessionDir(root, workspace, "session-forged");
    await mkdir(dir, { recursive: true });
    const now = 1_700_000_300_000;
    const header = { id: "session-forged", version: SESSION_FORMAT_VERSION, createdAt: now, cwd: elsewhere };
    const events = [{ type: "user/message", seq: 0, time: now, data: { text: "forged secret" } }];
    await writeFile(sessionLogPath(dir), serializeHeader(header) + events.map(serializeEvent).join(""), "utf8");

    const store = new SessionStore({ root, cwd: workspace });
    const registry = new ToolRegistry();
    registerSessionQueryTools(registry, { workspace, store });

    const listed = await registry.call("session_list", {}) as SessionListOutput;
    expect(listed.sessions).toEqual([]);
    const searched = await registry.call("session_search", { query: "forged" }) as SessionSearchOutput;
    expect(searched.matches).toEqual([]);
    await expect(registry.call("session_read", { session: "session-forged" })).rejects.toThrow(/No session|another workspace/);
  });

  it("does not request approval for workspace history", async () => {
    const fixtureValue = await fixture();
    const deny = async () => {
      throw new Error("session query tools must not request approval");
    };
    await expect(registryFor(fixtureValue).call("session_list", {}, deny)).resolves.toMatchObject({ truncated: false });
  });
});
