import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { encodeSegment, projectDirName, sessionDir, sessionLogPath, sessionsRoot } from "../src/paths.ts";

describe("session paths", () => {
  it("resolves the default root under ~/.ringko", () => {
    const env = { RINGKO_HOME: join("/home", "u") } as NodeJS.ProcessEnv;
    expect(sessionsRoot(env)).toBe(join("/home/u", ".ringko", "sessions"));
  });

  it("names project directories from the cwd", () => {
    expect(projectDirName(undefined)).toBe("_no-cwd");
    expect(projectDirName("")).toBe("_no-cwd");
    expect(projectDirName("C:\\Users\\me\\proj")).toBe("--C-Users-me-proj--");
    expect(projectDirName("/home/me/proj")).toBe("--home-me-proj--");
  });

  it("encodes session ids injectively", () => {
    expect(encodeSegment("session-1")).toBe("session-1");
    expect(encodeSegment("a/b")).toBe("a~002fb");
    expect(encodeSegment("../x")).toBe("..~002fx");
    expect(() => encodeSegment("")).toThrow("must not be empty");
  });

  it("builds the session dir and log path", () => {
    const dir = sessionDir("/root", "/home/me", "s1");
    expect(dir).toBe(join("/root", "--home-me--", "s1"));
    expect(sessionLogPath(dir)).toBe(join(dir, "session.jsonl"));
  });
});
