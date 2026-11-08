import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legacyProjectDirName, sessionDir, sessionLogPath } from "../src/paths.ts";
import { serializeHeader } from "../src/format.ts";
import { SessionStore } from "../src/store.ts";

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
    expect(existsSync(sessionDir(root, cwd, "s1"))).toBe(
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
    expect(() => store().delete("s3")).toThrow("locked");

    writer.close();
    const reopened = store().open("s3", "write");
    reopened.close();
  });

  it("releases the writer lock even when persistence and descriptor cleanup fail", () => {
    const writer = store().create(); writer.appendEvent("persisted", {}); writer.flush();
    // Isolated fault injection: invalidate the underlying descriptor before the next flush.
    closeSync(Reflect.get(writer, "fd") as number);
    writer.appendEvent("not-persisted", {});
    expect(() => writer.flush()).toThrow();
    expect(() => writer.appendEvent("must-fail-closed", {})).toThrow();
    expect(() => writer.close()).toThrow();
    const recovered = store().open(writer.id, "write");
    expect(recovered.all()).toHaveLength(1); recovered.close();
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

  it("does not advance sequence when a batch cannot be serialized", () => {
    const session = store().create({ id: "invalid-batch" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => session.append([
      { type: "valid", data: { value: 1 } },
      { type: "invalid", data: circular },
    ])).toThrow();
    expect(session.all()).toHaveLength(0);
    session.appendEvent("valid", { value: 2 });
    session.close();
    expect(store().open("invalid-batch", "read").all()).toMatchObject([
      { type: "valid", seq: 0, data: { value: 2 } },
    ]);
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

  it("repairs a torn trailing write before appending new events", () => {
    const session = store().create({ id: "s-torn-append" });
    session.appendEvent("user/message", { text: "before" });
    session.flush();
    session.close();

    const dir = store().findDir("s-torn-append")!;
    appendFileSync(sessionLogPath(dir), '{"type":"tool/res');

    const writer = store().open("s-torn-append", "write");
    writer.appendEvent("user/message", { text: "after" });
    writer.close();

    const reopened = store().open("s-torn-append", "read");
    expect(reopened.all().map((event) => (event.data as { text: string }).text)).toEqual(["before", "after"]);
    reopened.close();
  });

  it("throws for an unknown session", () => {
    expect(() => store().open("missing")).toThrow("No session with id");
  });

  it("round-trips special ids and rejects a duplicate without corrupting the log", () => {
    const ids = ["..", ".", "\u{1f600}", "\u1f60" + "0", "a", "A", "con"];
    for (const id of ids) { const session = store().create({ id }); session.appendEvent("probe", { id }); session.close(); }
    for (const id of ids) { const session = store().open(id); expect(session.all()[0]?.data).toEqual({ id }); session.close(); }
    const duplicate = store().create({ id: ids[0] }); duplicate.appendEvent("duplicate");
    expect(() => duplicate.flush()).toThrow(); expect(() => duplicate.close()).toThrow();
    expect(store().open(ids[0]!).all()).toHaveLength(1);
  });

  it("reads legacy layouts while separating colliding workspace names", () => {
    const firstCwd = join(root, "a-b", "c"), secondCwd = join(root, "a", "b-c");
    const first = new SessionStore({ root, cwd: firstCwd }), second = new SessionStore({ root, cwd: secondCwd });
    expect(legacyProjectDirName(firstCwd)).toBe(legacyProjectDirName(secondCwd));
    for (const [id, cwd] of [["legacy-one", firstCwd], ["legacy-two", secondCwd]]) {
      const dir = join(root, legacyProjectDirName(cwd), id!); mkdirSync(dir, { recursive: true });
      writeFileSync(sessionLogPath(dir), serializeHeader({ id: id!, cwd, version: 1, createdAt: Date.now() }));
    }
    const fresh = first.create({ id: "new-one" }); fresh.appendEvent("new"); fresh.close();
    expect(first.list().map(s => s.id).sort()).toEqual(["legacy-one", "new-one"]);
    expect(second.list().map(s => s.id)).toEqual(["legacy-two"]);
    const reopened = first.open("legacy-one", "write"); reopened.appendEvent("continued"); reopened.close();
    expect(first.open("legacy-one").all()).toHaveLength(1);
  });
});
