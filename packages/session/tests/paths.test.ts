import { describe, expect, it } from "bun:test";
import { basename, dirname, join } from "node:path";
import { encodeSegment, legacyProjectDirName, projectDirName, sessionDir, sessionLogPath, sessionsRoot } from "../src/paths.ts";

describe("session paths", () => {
  it("resolves the default root under ~/.ringko", () => {
    const env = { RINGKO_HOME: join("/home", "u") } as NodeJS.ProcessEnv;
    expect(sessionsRoot(env)).toBe(join("/home/u", ".ringko", "sessions"));
  });

  it("names project directories from the cwd", () => {
    expect(projectDirName(undefined)).toBe("_no-cwd");
    expect(projectDirName("")).toBe("_no-cwd");
    expect(projectDirName("/home/me/proj")).toMatch(/^--[a-f0-9]{64}--$/);
    expect(projectDirName("/home/me/proj")).not.toBe(projectDirName("/home/me-proj"));
    expect(legacyProjectDirName("C:\\Users\\me\\proj")).toBe("--C-Users-me-proj--");
    expect(legacyProjectDirName("/home/me/proj")).toBe("--home-me-proj--");
  });

  it("encodes session ids injectively", () => {
    expect(encodeSegment("session-1")).toBe("s-session-1");
    expect(encodeSegment("a/b")).toBe("s-a~002fb");
    expect(encodeSegment("../x")).toBe("s-~002e~002e~002fx");
    expect(() => encodeSegment("")).toThrow("must not be empty");
  });

  it("builds the session dir and log path", () => {
    const dir = sessionDir("/root", "/home/me", "s1");
    expect(dir).toBe(join("/root", projectDirName("/home/me"), encodeSegment("s1")));
    expect(sessionLogPath(dir)).toBe(join(dir, "session.jsonl"));
  });

  it("contains dot ids, device names, case variants and fixed-width Unicode escapes", () => {
    const ids = [".", "..", "con", "CON", "a", "A", "a.", "\u{1f600}", "\u1f60" + "0", "\ud800", "\ufffd"];
    expect(new Set(ids.map(id => encodeSegment(id).toLowerCase())).size).toBe(ids.length);
    for (const id of ids) {
      const dir = sessionDir("/root", "/workspace", id);
      expect(dirname(dir)).toBe(join("/root", projectDirName("/workspace")));
      expect(basename(dir)).toBe(encodeSegment(id));
    }
    expect(() => encodeSegment("x".repeat(254))).toThrow("segment limit");
  });
});
