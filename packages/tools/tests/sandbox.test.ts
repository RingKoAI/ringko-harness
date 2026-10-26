import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
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

    const full = new Sandbox({ workspace, mode: "danger-full-access" });
    expect(() => full.assertWrite(join(dir, "outside.txt"))).not.toThrow();
  });

  it("wraps shell commands and fails closed without a runner", async () => {
    const workspace = join(dir, "workspace");
    await Bun.write(join(workspace, ".keep"), "");
    const sandbox = new Sandbox({ workspace, mode: "workspace-write", runner: "bwrap" });
    const invocation = sandbox.shell("echo ok", workspace);
    expect(invocation.executable).toBe("bwrap");
    expect(invocation.args).toContain(workspace);
    expect(invocation.args.at(-1)).toBe("echo ok");

    const unavailable = new Sandbox({ workspace, mode: "workspace-write", runner: "none" });
    expect(() => unavailable.shell("echo ok")).toThrow(SandboxUnavailableError);
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

  it("authorizes the same Windows directory through short and long path spellings", async () => {
    if (process.platform !== "win32") return;
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
});

