import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { executeTool } from "@ringko-ai/harness";
import { Sandbox, SandboxDeniedError, SandboxUnavailableError, createWorkspace, createWriteTool } from "../src/index.ts";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ringko-sandbox-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("Sandbox", () => {
  it("defaults to workspace-write", async () => {
    const workspace = join(dir, "default-workspace");
    await Bun.write(join(workspace, ".keep"), "");
    expect(new Sandbox({ workspace }).mode).toBe("workspace-write");
  });
  it("enforces read-only and workspace-write file boundaries", async () => {
    const workspace = join(dir, "workspace");
    await Bun.write(join(workspace, ".keep"), "");
    const readOnly = new Sandbox({ workspace, mode: "read-only", runner: "bwrap" });
    expect(() => readOnly.assertWrite(join(workspace, "new.txt"))).toThrow(SandboxDeniedError);

    const confined = new Sandbox({ workspace, mode: "workspace-write", runner: "bwrap" });
    expect(() => confined.assertWrite(join(workspace, "new.txt"))).not.toThrow();
    expect(() => confined.assertWrite(join(dir, "outside.txt"))).toThrow(SandboxDeniedError);

    const extra = join(dir, "extra");
    await mkdir(extra);
    const withExtra = new Sandbox({ workspace, mode: "workspace-write", runner: "bwrap", additionalWritableRoots: [extra] });
    expect(() => withExtra.assertWrite(join(extra, "allowed.txt"))).not.toThrow();
    expect(new Sandbox({ workspace, additionalWritableRoots: [extra, extra, workspace] }).additionalWritableRoots).toEqual([await realpath(extra)]);

    const full = new Sandbox({ workspace, mode: "danger-full-access" });
    expect(() => full.assertWrite(join(dir, "outside.txt"))).not.toThrow();
  });

  it("wraps shell commands and fails closed without a runner", async () => {
    const workspace = join(dir, "workspace");
    await Bun.write(join(workspace, ".keep"), "");
    const sandbox = new Sandbox({ workspace, mode: "workspace-write", runner: "bwrap" });
    const invocation = sandbox.shell("echo ok", workspace);
    expect(invocation.executable).toMatch(/[/\\]bwrap(?:\.exe)?$/);
    expect(invocation.args).toContain(workspace);
    expect(invocation.args.at(-1)).toBe("echo ok");

    const unavailable = new Sandbox({ workspace, mode: "workspace-write", runner: "none" });
    expect(() => unavailable.shell("echo ok")).toThrow(SandboxUnavailableError);
  });

  it("removes ambient credentials but retains explicitly configured connector values", async () => {
    const original = process.env.SANDBOX_TEST_TOKEN;
    process.env.SANDBOX_TEST_TOKEN = "ambient-fixture";
    try {
      const sandbox = new Sandbox({ workspace: dir, runner: "bwrap" });
      const invocation = sandbox.wrap("fixture", [], dir, { AUTHORIZED_TOOL_TOKEN: "configured-fixture" });
      expect(invocation.env?.SANDBOX_TEST_TOKEN).toBeUndefined();
      expect(invocation.env?.AUTHORIZED_TOOL_TOKEN).toBe("configured-fixture");
      expect(invocation.env?.TMPDIR).toBe("/tmp");
    } finally {
      if (original === undefined) delete process.env.SANDBOX_TEST_TOKEN; else process.env.SANDBOX_TEST_TOKEN = original;
    }
  });

  it("rejects explicit loader injection and pins the runner before applying connector PATH", async () => {
    const sandbox = new Sandbox({ workspace: dir, runner: "bwrap" });
    for (const name of ["LD_PRELOAD", "LD_AUDIT", "DYLD_INSERT_LIBRARIES", "COR_PROFILER_PATH", "COMPLUS_Version", "NODE_OPTIONS", "DOTNET_STARTUP_HOOKS"]) {
      expect(() => sandbox.wrap("fixture", [], dir, { [name]: "hostile-fixture" })).toThrow("launcher environment override");
      await expect(sandbox.prepare({ [name]: "hostile-fixture" })).rejects.toThrow("launcher environment override");
    }
    const invocation = sandbox.wrap("fixture", [], dir, { PATH: dir });
    expect(invocation.executable).not.toBe(join(dir, "bwrap"));
    expect(invocation.executable).toMatch(/[/\\]bwrap(?:\.exe)?$/);
    expect(invocation.env?.PATH).toBe(dir);
  });

  it("limits Seatbelt temporary writes to a private canonical directory", () => {
    const sandbox = new Sandbox({ workspace: dir, runner: "seatbelt", mode: "read-only" });
    const invocation = sandbox.shell("fixture");
    expect(invocation.args[1]).not.toContain('(subpath "/tmp")');
    expect(invocation.args[1]).not.toContain('(subpath "/private/tmp")');
    expect(invocation.env?.TMPDIR).toBeDefined();
    expect(() => sandbox.assertWrite(join(invocation.env!.TMPDIR!, "temporary.txt"))).not.toThrow();
  });

  it("accepts workspace aliases but rejects junctions escaping the write boundary", async () => {
    const workspace = join(dir, "workspace");
    const external = join(dir, "external");
    const alias = join(dir, "alias");
    await Promise.all([mkdir(workspace), mkdir(external)]);
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(workspace, alias, type);
    await symlink(external, join(workspace, "escape"), type);
    const sandbox = new Sandbox({ workspace: alias });
    expect(() => sandbox.assertWrite(join(alias, "nested", "new.txt"))).not.toThrow();
    expect(() => sandbox.assertWrite(join(alias, "escape", "new.txt"))).toThrow(SandboxDeniedError);
  });

  it("denies file tools before they touch the filesystem", async () => {
    const workspace = join(dir, "workspace");
    await Bun.write(join(workspace, ".keep"), "");
    const approve = async (): Promise<boolean> => true;
    const confined = new Sandbox({ workspace, mode: "workspace-write", runner: "bwrap" });
    const write = createWriteTool(createWorkspace(workspace), undefined, confined);
    await expect(executeTool(write, { path: join(dir, "outside.txt"), content: "x" }, approve)).rejects.toBeInstanceOf(SandboxDeniedError);
    const written = await executeTool(write, { path: "inside.txt", content: "x" }, approve);
    expect(written).toMatchObject({ path: "inside.txt" });

    const readOnly = new Sandbox({ workspace, mode: "read-only", runner: "bwrap" });
    const blocked = createWriteTool(createWorkspace(workspace), undefined, readOnly);
    await expect(executeTool(blocked, { path: "inside.txt", content: "y" }, approve)).rejects.toBeInstanceOf(SandboxDeniedError);
  });

  it("does not let approval bypass a direct file tool's default sandbox", async () => {
    const workspace = join(dir, "workspace");
    await mkdir(workspace);
    const tool = createWriteTool(createWorkspace(workspace));
    await expect(executeTool(tool, { path: join(dir, "outside.txt"), content: "blocked" }, async () => true)).rejects.toBeInstanceOf(SandboxDeniedError);
  });

  it.skipIf(process.platform !== "win32")("authorizes the same Windows directory through short and long path spellings", async () => {
    const workspace = join(dir, "workspace with a long name");
    await mkdir(workspace);
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `for %I in ("${workspace}") do @echo %~fsI`], { encoding: "utf8", windowsVerbatimArguments: true });
    expect(result.status).toBe(0);
    const shortPath = result.stdout.trim();
    expect(shortPath.length).toBeGreaterThan(0);
    const sandbox = new Sandbox({ workspace: shortPath });
    const write = createWriteTool(createWorkspace(workspace), undefined, sandbox);
    const written = await executeTool(write, { path: "inside.txt", content: "allowed" }, async () => true);
    expect(written).toMatchObject({ path: "inside.txt" });
    expect(() => sandbox.assertWrite(join(dir, "outside.txt"))).toThrow(SandboxDeniedError);
  });

  it.skipIf(process.platform !== "win32")("rejects UNC and device roots before making filesystem or network requests", () => {
    expect(() => new Sandbox({ workspace: "\\\\untrusted.invalid\\share" })).toThrow("local drive path");
    expect(() => new Sandbox({ workspace: "\\\\.\\GLOBALROOT" })).toThrow("local drive path");
  });
});

