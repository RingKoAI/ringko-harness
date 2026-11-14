import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeTool } from "@ringko-ai/harness";
import { Sandbox } from "../src/sandbox.ts";
import { createWriteTool } from "../src/write.ts";
import { createEditTool } from "../src/edit.ts";
import { createShellTool } from "../src/shell.ts";
import { createWorkspace } from "../src/workspace.ts";
let root: string, workspace: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "rkh-permission-presets-")); workspace = join(root, "workspace"); mkdirSync(workspace); });
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

it("keeps read-only writes gated and scopes each explicit approval to the assessed target", async () => {
  const sandbox = new Sandbox({ workspace, mode: "read-only", allowApprovedWrites: true });
  const tool = createWriteTool(createWorkspace(workspace), undefined, sandbox), input = { path: "file.txt", content: "approved" };
  await expect(executeTool(tool, input)).rejects.toThrow("requires approval");
  await expect(executeTool(tool, input, async () => false)).rejects.toThrow("not granted");
  expect(existsSync(join(workspace, input.path))).toBe(false);
  await executeTool(tool, input, async () => true);
  expect(readFileSync(join(workspace, input.path), "utf8")).toBe("approved"); expect(sandbox.mode).toBe("read-only");
  const edit = createEditTool(createWorkspace(workspace), undefined, sandbox);
  await expect(executeTool(edit, { path: "file.txt", old_string: "approved", new_string: "edited" })).rejects.toThrow("requires approval");
  await executeTool(edit, { path: "file.txt", old_string: "approved", new_string: "edited" }, async () => true);
  expect(readFileSync(join(workspace, input.path), "utf8")).toBe("edited");
  await expect(executeTool(tool, { path: "other.txt", content: "not approved" })).rejects.toThrow("requires approval");
  expect(existsSync(join(workspace, "other.txt"))).toBe(false);
});

it("does not convert saved allow rules or caller-supplied context into sandbox escalation", async () => {
  const sandbox = new Sandbox({ workspace, mode: "read-only", allowApprovedWrites: true });
  const tool = createWriteTool(createWorkspace(workspace), undefined, sandbox);
  await expect(executeTool(tool, { path: "denied.txt", content: "denied" }, undefined, "approval", { approvalGranted: true, permissionCheck: async () => "allow" })).rejects.toThrow("requires approval");
  expect(existsSync(join(workspace, "denied.txt"))).toBe(false);
  const legacy = createWriteTool(createWorkspace(workspace), undefined, new Sandbox({ workspace, mode: "read-only" }));
  await expect(executeTool(legacy, { path: "legacy.txt", content: "denied" }, async () => true)).rejects.toThrow("read-only denies");
});

it("allows default workspace creation and only approved external file writes; full access needs no ordinary prompt", async () => {
  const outside = join(root, "outside.txt");
  const normal = createWriteTool(createWorkspace(workspace), undefined, new Sandbox({ workspace, allowApprovedWrites: true }));
  await executeTool(normal, { path: "inside.txt", content: "inside" });
  await expect(executeTool(normal, { path: outside, content: "outside" })).rejects.toThrow("requires approval");
  await executeTool(normal, { path: outside, content: "outside" }, async () => true);
  expect(readFileSync(outside, "utf8")).toBe("outside");
  const full = createWriteTool(createWorkspace(workspace), undefined, new Sandbox({ workspace, mode: "danger-full-access" }));
  await executeTool(full, { path: outside, content: "full" }, undefined, "full");
  await expect(executeTool(full, { path: outside, content: "blocked" }, undefined, "full", { permissionCheck: async () => "deny" })).rejects.toThrow("not granted");
  expect(readFileSync(outside, "utf8")).toBe("full");
});

it.skipIf(process.platform !== "win32")("requires one-command approval for shell escalation without changing read-only mode", async () => {
  const sandbox = new Sandbox({ workspace, mode: "read-only", allowApprovedWrites: true });
  const tool = createShellTool({ cwd: workspace, sandbox });
  const command = "echo approved>shell.txt", input = { command, sandbox_permissions: "workspace-write" as const };
  await expect(executeTool(tool, input, async () => false)).rejects.toThrow("not granted");
  await expect(executeTool(tool, input, undefined, "approval", { permissionCheck: async () => "allow" })).rejects.toThrow("requires approval");
  await executeTool(tool, input, async () => true);
  expect(readFileSync(join(workspace, "shell.txt"), "utf8")).toContain("approved"); expect(sandbox.mode).toBe("read-only");
  const result = await executeTool(tool, { command: "echo blocked>next.txt" }, async () => true);
  expect(result).toMatchObject({ exitCode: 1 }); expect(existsSync(join(workspace, "next.txt"))).toBe(false);
}, 30000);
