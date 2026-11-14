import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTRUCTION_LIMITS, instructionsText, loadInstructions } from "../src/instructions.ts";

it("loads global and project rules with existing precedence and observes edits on reload", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-files-"));
  const env = { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") };
  const cwd = join(root, "project");
  try {
    mkdirSync(join(cwd, ".git"), { recursive: true });
    mkdirSync(join(env.RINGKO_HOME, ".ringko"), { recursive: true });
    mkdirSync(join(env.AGENTS_HOME, ".agents"), { recursive: true });
    writeFileSync(join(env.RINGKO_HOME, ".ringko", "AGENTS.md"), "Global rules");
    writeFileSync(join(env.AGENTS_HOME, ".agents", "AGENTS.md"), "Lower priority global rules");
    writeFileSync(join(cwd, "AGENTS.md"), "Project rules");
    writeFileSync(join(cwd, "CLAUDE.md"), "Fallback project rules");
    expect(loadInstructions({ cwd, env }).map(file => file.content)).toEqual(["Global rules", "Project rules"]);
    writeFileSync(join(cwd, "AGENTS.md"), "Edited rules");
    expect(instructionsText(loadInstructions({ cwd, env }))).toContain("Edited rules");
    rmSync(join(cwd, "AGENTS.md"));
    expect(loadInstructions({ cwd, env }).at(-1)?.content).toBe("Fallback project rules");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("recursively injects nested AGENTS.md files with stable ordering", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-recursive-"));
  try {
    const cwd = join(root, "project");
    mkdirSync(join(cwd, ".git"), { recursive: true });
    writeFileSync(join(cwd, "AGENTS.md"), "Root rules");
    mkdirSync(join(cwd, "pkg", "deep"), { recursive: true });
    writeFileSync(join(cwd, "pkg", "AGENTS.md"), "Package rules");
    writeFileSync(join(cwd, "pkg", "deep", "AGENTS.md"), "Deep rules");
    mkdirSync(join(cwd, "node_modules", "ignored"), { recursive: true });
    writeFileSync(join(cwd, "node_modules", "ignored", "AGENTS.md"), "Ignored rules");
    mkdirSync(join(cwd, ".hidden"), { recursive: true });
    writeFileSync(join(cwd, ".hidden", "AGENTS.md"), "Hidden rules");
    const names = loadInstructions({ cwd, env: { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") } }).map(file => file.content);
    expect(names).toEqual(["Root rules", "Package rules", "Deep rules"]);
    expect(loadInstructions({ cwd, recursive: false, env: { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") } }).map(file => file.content)).toEqual(["Root rules"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("does not duplicate a file discovered in both global and project scopes", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-dedupe-"));
  try {
    const cwd = join(root, ".ringko"); mkdirSync(cwd);
    writeFileSync(join(cwd, "AGENTS.md"), "Single policy");
    expect(loadInstructions({ cwd, env: { RINGKO_HOME: root, AGENTS_HOME: join(root, "other") } })).toHaveLength(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("rejects excessive aggregate instructions instead of silently truncating policies", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-size-"));
  try {
    mkdirSync(join(root, ".git"));
    let cwd = root;
    for (let index = 0; index < 5; index++) {
      writeFileSync(join(cwd, "AGENTS.md"), "x".repeat(INSTRUCTION_LIMITS.fileBytes));
      cwd = join(cwd, "child"); mkdirSync(cwd);
    }
    expect(() => loadInstructions({ cwd, env: { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "other") } })).toThrow("Instruction context exceeds");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("skips independent repositories and worktrees while preserving the workspace and normal child rules", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-repositories-"));
  const env = { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") };
  const cwd = join(root, "project");
  try {
    mkdirSync(join(cwd, ".git"), { recursive: true }); writeFileSync(join(cwd, "AGENTS.md"), "Root");
    mkdirSync(join(cwd, "pkg")); writeFileSync(join(cwd, "pkg", "AGENTS.md"), "Package");
    for (const [name, marker] of [["git-repo", ".git"], ["hg-repo", ".hg"], ["svn-repo", ".svn"], ["worktree", ".git"]]) {
      const nested = join(cwd, "Example", name!); mkdirSync(nested, { recursive: true });
      if (name === "worktree") writeFileSync(join(nested, marker!), "gitdir: ../metadata"); else mkdirSync(join(nested, marker!));
      writeFileSync(join(nested, "AGENTS.md"), name!);
      for (let index = 0; index < 6; index++) mkdirSync(join(nested, String(index)));
    }
    expect(loadInstructions({ cwd, env, scan: { maxDirectories: 3 } }).map(file => file.content)).toEqual(["Root", "Package"]);
    expect(loadInstructions({ cwd, env, scan: { excludeNestedRepositories: false } }).map(file => file.content)).toContain("worktree");
    const nested = join(cwd, "Example", "git-repo");
    expect(loadInstructions({ cwd: nested, env }).map(file => file.content)).toEqual(["git-repo"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("matches excluded names at any depth and paths only from the workspace root", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-excludes-"));
  const env = { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") };
  try {
    mkdirSync(join(root, ".git")); writeFileSync(join(root, "AGENTS.md"), "Root");
    for (const path of ["Example", "Example-copy", "pkg/build", "pkg/building", "keep/pkg/building"]) {
      mkdirSync(join(root, path), { recursive: true }); writeFileSync(join(root, path, "AGENTS.md"), path);
    }
    const files = loadInstructions({ cwd: root, env, scan: { excludeDirectories: ["Example", "build", "pkg\\building"] } }).map(file => file.content);
    expect(files).toEqual(["Root", "Example-copy", "keep/pkg/building"]);
    expect(loadInstructions({ cwd: root, env, scan: { recursive: false } }).map(file => file.content)).toEqual(["Root"]);
    expect(loadInstructions({ cwd: root, env, recursive: true, scan: { recursive: false } }).length).toBeGreaterThan(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("honors inclusive depth and directory budgets and still fails when actual scope exceeds its budget", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-budgets-"));
  const env = { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") };
  try {
    mkdirSync(join(root, ".git")); mkdirSync(join(root, "child", "deep"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "Root"); writeFileSync(join(root, "child", "AGENTS.md"), "Child"); writeFileSync(join(root, "child", "deep", "AGENTS.md"), "Deep");
    expect(loadInstructions({ cwd: root, env, scan: { maxDepth: 0, maxDirectories: 1 } }).map(file => file.content)).toEqual(["Root"]);
    expect(loadInstructions({ cwd: root, env, scan: { maxDepth: 1, maxDirectories: 2 } }).map(file => file.content)).toEqual(["Root", "Child"]);
    expect(() => loadInstructions({ cwd: root, env, scan: { maxDirectories: 2 } })).toThrow("directory limit (2)");
    expect(loadInstructions({ cwd: root, env, scan: { maxDirectories: 3 } }).map(file => file.content)).toEqual(["Root", "Child", "Deep"]);
    expect(() => loadInstructions({ cwd: join(root, "missing"), env })).toThrow("Cannot scan instruction directory");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("rejects excessive nested policy counts during discovery", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-count-"));
  try {
    mkdirSync(join(root, ".git"));
    for (let index = 0; index <= INSTRUCTION_LIMITS.files; index++) { const directory = join(root, String(index)); mkdirSync(directory); writeFileSync(join(directory, "AGENTS.md"), "Policy"); }
    expect(() => loadInstructions({ cwd: root, env: { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") } })).toThrow("Too many instruction files");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("does not traverse directory symlinks even when repository exclusions are disabled", () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-rule-links-"));
  try {
    const cwd = join(root, "project"), outside = join(root, "outside"); mkdirSync(cwd); mkdirSync(outside);
    writeFileSync(join(outside, "AGENTS.md"), "External policy"); symlinkSync(outside, join(cwd, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(loadInstructions({ cwd, env: { RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") }, scan: { excludeNestedRepositories: false } })).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
