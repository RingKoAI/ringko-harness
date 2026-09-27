import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionLogPath } from "./paths.ts";
import { SessionStore } from "./store.ts";

let root: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ringko-sessions-"));
  cwd = join(tmpdir(), "workspace");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function store(): SessionStore {
  return new SessionStore({ root, cwd });
}

describe("SessionStore", () => {
  it("materializes lazily on flush", () => {
    const session = store().create({ id: "s1" });
    expect(session.id).toBe("s1");
    expect(existsSync(join(root, "--" + cwd.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1").replace(/[/]+/g, "-") + "--", "s1"))).toBe(
      false,
    );

    session.appendEvent("user/message", { text: "hi" });
    session.appendEvent("assistant/message", { text: "hello" });
    session.flush();
    session.close();

    const dir = store().findDir("s1");
    expect(dir).toBeDefined();
    const lines = readFileSync(sessionLogPath(dir!), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toMatchObject({ type: "user/message", seq: 0, data: { text: "hi" } });
    expect(JSON.parse(lines[2])).toMatchObject({ type: "assistant/message", seq: 1 });
  });

  it("opens and lists sessions", () => {
    const session = store().create({ id: "s2" });
    session.appendEvent("user/message", { text: "one" });
    session.flush();
    session.close();

    const opened = store().open("s2", "read");
    expect(opened.all().map((event) => event.type)).toEqual(["user/message"]);

    const metas = store().list();
    expect(metas.map((meta) => meta.id)).toContain("s2");
    expect(metas[0].header.cwd).toBe(cwd);
  });

  it("enforces a single writer", () => {
    const writer = store().create({ id: "s3" });
    writer.appendEvent("user/message", {});
    writer.flush();

    expect(() => store().open("s3", "write")).toThrow("locked");

    writer.close();
    const reopened = store().open("s3", "write");
    reopened.close();
  });

  it("rejects appends on a read-only handle", () => {
    const session = store().create({ id: "s4" });
    session.appendEvent("a", {});
    session.flush();
    session.close();

    const reader = store().open("s4", "read");
    expect(() => reader.appendEvent("b", {})).toThrow("read-only");
    reader.close();
  });

  it("ignores a torn trailing write", () => {
    const session = store().create({ id: "s5" });
    session.appendEvent("user/message", { text: "ok" });
    session.flush();
    session.close();

    const dir = store().findDir("s5")!;
    appendFileSync(sessionLogPath(dir), '{"type":"partial","seq":1,"ti');

    const reopened = store().open("s5", "read");
    expect(reopened.all().map((event) => event.type)).toEqual(["user/message"]);
    reopened.close();
  });

  it("throws for an unknown session", () => {
    expect(() => store().open("missing")).toThrow("No session with id");
  });
});
