import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, parseSkillFrontmatter } from "../src/skills.ts";

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

  it("returns an empty list when nothing is installed", () => {
    expect(discoverSkills({ env, cwd: home })).toEqual([]);
  });
});
