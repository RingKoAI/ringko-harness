import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
