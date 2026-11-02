import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_BASH_PATH_ENV, findGitBash, interactiveShell, shellCommand } from "../src/shell-resolver.ts";

describe("shell resolver", () => {
  it("uses an explicit Git Bash path and fails closed when it is missing", () => {
    const override = join(tmpdir(), "rkh-fake-bash.exe");
    const env = { [GIT_BASH_PATH_ENV]: override } as NodeJS.ProcessEnv;
    expect(findGitBash(env, () => true)).toBe(override);
    expect(() => findGitBash(env, () => false)).toThrow(GIT_BASH_PATH_ENV);
  });

  it("finds Git Bash under a known install root", () => {
    const root = "C:\\Program Files";
    const expected = join(root, "Git", "bin", "bash.exe");
    expect(findGitBash({ ProgramFiles: root } as NodeJS.ProcessEnv, (path) => path === expected)).toBe(expected);
  });

  it("falls back to cmd on Windows and /bin/sh elsewhere", () => {
    const cmd = shellCommand("echo hi", "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" } as NodeJS.ProcessEnv);
    expect(cmd.kind).toBe("cmd");
    expect(cmd.args).toEqual(["/d", "/s", "/c", "echo hi"]);
    expect(shellCommand("echo hi", "linux", {}).kind).toBe("posix");
  });

  it("honors a request to avoid Git Bash", () => {
    const invocation = shellCommand(
      "echo hi",
      "win32",
      { ComSpec: "C:\\Windows\\System32\\cmd.exe", ProgramFiles: "C:\\Program Files" } as NodeJS.ProcessEnv,
      { preferGitBash: false },
    );
    expect(invocation.kind).toBe("cmd");
  });

  it("prefers Git Bash when it is installed", () => {
    if (process.platform !== "win32" || !findGitBash()) return;
    expect(shellCommand("echo hi").kind).toBe("git-bash");
  });

  it("runs a command through the resolved shell", () => {
    const invocation = shellCommand("echo resolved-shell");
    const result = spawnSync(invocation.executable, invocation.args, { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("resolved-shell");
  });

  it("returns an interactive invocation", () => {
    const invocation = interactiveShell();
    expect(invocation.executable.length).toBeGreaterThan(0);
    expect(invocation.args.length).toBeGreaterThan(0);
  });
});
