import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, installSkill, parseSkillFrontmatter, removeSkill } from "../src/skills.ts";

let home: string;
let env: NodeJS.ProcessEnv;

function writeSkill(root: string, name: string, body: string): void {
  const dir = join(root, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-skills-"));
  env = { RINGKO_HOME: home, AGENTS_HOME: home } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("parseSkillFrontmatter", () => {
  it("reads name and description", () => {
    const text = "---\nname: my-skill\ndescription: Does a thing.\n---\n\n# Body\n";
    expect(parseSkillFrontmatter(text)).toEqual({ name: "my-skill", description: "Does a thing." });
  });

  it("returns undefined without a name", () => {
    expect(parseSkillFrontmatter("---\ndescription: x\n---\n")).toBeUndefined();
    expect(parseSkillFrontmatter("# no frontmatter")).toBeUndefined();
  });
});

describe("installSkill", () => {
  function writeSource(root: string, name: string, extra?: (dir: string) => void): string {
    const dir = join(root, "source");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Installed skill\n---\nBody`);
    extra?.(dir);
    return dir;
  }

  it("installs into the global skills root", () => {
    const source = writeSource(home, "installed", dir => {
      mkdirSync(join(dir, "references"));
      writeFileSync(join(dir, "references", "note.txt"), "note");
    });
    const skill = installSkill({ source, scope: "global", env, cwd: home });
    expect(skill).toEqual({ name: "installed", description: "Installed skill", dir: join(home, ".ringko", "skills", "installed"), source: "ringko", scope: "global" });
    expect(discoverSkills({ env, cwd: home }).find(entry => entry.name === "installed")?.scope).toBe("global");
  });

  it("installs into the current project skills root", () => {
    const project = mkdtempSync(join(tmpdir(), "ringko-install-proj-"));
    const sub = join(project, "app");
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(project, ".git"));
    try {
      const source = writeSource(home, "project-skill");
      const skill = installSkill({ source, scope: "project", env, cwd: sub });
      expect(skill.dir).toBe(join(project, ".ringko", "skills", "project-skill"));
      expect(skill.source).toBe("project");
      expect(discoverSkills({ env, cwd: sub }).find(entry => entry.name === "project-skill")?.scope).toBe("project");
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it("refuses to overwrite an installed skill", () => {
    const source = writeSource(home, "duplicate");
    installSkill({ source, scope: "global", env, cwd: home });
    expect(() => installSkill({ source, scope: "global", env, cwd: home })).toThrow("already installed");
  });

  it("rejects unsafe names and missing manifests", () => {
    const source = writeSource(home, "../escape");
    expect(() => installSkill({ source, scope: "global", env, cwd: home })).toThrow("single path segment");
    const empty = join(home, "empty");
    mkdirSync(empty, { recursive: true });
    expect(() => installSkill({ source: empty, scope: "global", env, cwd: home })).toThrow("must contain SKILL.md");
  });

  it("rejects symlinks without leaving a partial install", () => {
    const source = writeSource(home, "linked");
    try { symlinkSync(join(home, "outside"), join(source, "link")); }
    catch { return; }
    expect(() => installSkill({ source, scope: "global", env, cwd: home })).toThrow("symbolic links");
    expect(existsSync(join(home, ".ringko", "skills", "linked"))).toBeFalse();
  });

  it("rejects oversized SKILL.md files", () => {
    const source = join(home, "oversized");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "x".repeat(64 * 1024 + 1));
    expect(() => installSkill({ source, scope: "global", env, cwd: home })).toThrow("64 KiB");
  });
});

describe("discoverSkills", () => {
  it("finds skills under both roots", () => {
    writeSkill(join(home, ".ringko"), "alpha", "---\nname: alpha\ndescription: A.\n---\n");
    writeSkill(join(home, ".agents"), "beta", "---\nname: beta\ndescription: B.\n---\n");

    const skills = discoverSkills({ env, cwd: home });
    const names = skills.map((skill) => skill.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    expect(skills.find((skill) => skill.name === "alpha")?.source).toBe("ringko");
    expect(skills.find((skill) => skill.name === "beta")?.source).toBe("agents");
  });

  it("prefers the ringko skill on a name collision", () => {
    writeSkill(join(home, ".ringko"), "dup", "---\nname: dup\ndescription: from ringko\n---\n");
    writeSkill(join(home, ".agents"), "dup", "---\nname: dup\ndescription: from agents\n---\n");

    const skills = discoverSkills({ env, cwd: home });
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("from ringko");
  });

  it("falls back to the directory name without frontmatter", () => {
    writeSkill(join(home, ".ringko"), "plain", "# just a body\n");
    expect(discoverSkills({ env, cwd: home })).toEqual([
      { name: "plain", description: undefined, dir: join(home, ".ringko", "skills", "plain"), source: "ringko", scope: "global" },
    ]);
  });

  it("discovers project-level skills with the project scope", () => {
    const project = mkdtempSync(join(tmpdir(), "ringko-proj-"));
    const sub = join(project, "app");
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(project, ".git"));
    const dir = join(project, ".agents", "skills", "proj");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: proj\ndescription: P.\n---\n");

    const skills = discoverSkills({ env, cwd: sub });
    const proj = skills.find((skill) => skill.name === "proj");
    expect(proj?.scope).toBe("project");
    expect(proj?.source).toBe("project");

    rmSync(project, { recursive: true, force: true });
  });

  it("discovers shared skills in ancestor workspaces without overriding project skills", () => {
    const tree = join(home, "Desktop", "Projects");
    const project = join(tree, "Repo", "App");
    mkdirSync(join(project, ".git"), { recursive: true });
    writeSkill(join(tree, ".agents"), "shared", "---\nname: shared\ndescription: Shared.\n---\n");
    writeSkill(join(tree, ".agents"), "dup", "---\nname: dup\ndescription: from ancestors\n---\n");
    writeSkill(join(project, ".agents"), "dup", "---\nname: dup\ndescription: from project\n---\n");

    const skills = discoverSkills({ env, cwd: project });
    const shared = skills.find((skill) => skill.name === "shared");
    expect(shared).toMatchObject({ description: "Shared.", scope: "global", source: "agents", dir: join(tree, ".agents", "skills", "shared") });
    expect(skills.filter((skill) => skill.name === "dup")).toEqual([expect.objectContaining({ description: "from project", scope: "project" })]);
    // Ancestor skills are listed, so removing one from the UI must also be allowed.
    expect(removeSkill(shared!.dir, env, project)).toBe(true);
    expect(discoverSkills({ env, cwd: project }).some((skill) => skill.name === "shared")).toBe(false);
  });

  it("returns an empty list when nothing is installed", () => {
    expect(discoverSkills({ env, cwd: home })).toEqual([]);
  });
});
