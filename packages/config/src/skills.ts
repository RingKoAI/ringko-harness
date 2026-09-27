// Skill discovery from the user-level skill directories.
//
// A skill is a directory containing a `SKILL.md` whose YAML frontmatter declares
// at least a `name` (and usually a `description`). RingKo scans
// `~/.ringko/skills` and `~/.agents/skills` (and the singular `skill` alias);
// ringko-specific skills take precedence over shared ones with the same name.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { agentsRoot, ringkoRoot, SKILLS_DIR_NAMES, skillsDirs } from "./paths.ts";

export const SKILL_FILE_NAME = "SKILL.md";

export type SkillSource = "ringko" | "agents";

export interface SkillMetadata {
  name: string;
  description?: string;
}

export interface Skill extends SkillMetadata {
  /** Absolute directory containing the SKILL.md. */
  dir: string;
  source: SkillSource;
}

/** Parse the leading `---` YAML frontmatter for `name` and `description`. */
export function parseSkillFrontmatter(text: string): SkillMetadata | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return undefined;
  const body = match[1];

  const read = (key: string): string | undefined => {
    const line = new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`, "m").exec(body);
    if (!line) return undefined;
    let value = line[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : undefined;
  };

  const name = read("name");
  if (!name) return undefined;
  return { name, description: read("description") };
}

function listDirectories(base: string): string[] {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export interface DiscoverSkillsOptions {
  env?: NodeJS.ProcessEnv;
}

/** Discover skills across the user-level roots (ringko first, then agents). */
export function discoverSkills(options: DiscoverSkillsOptions = {}): Skill[] {
  const env = options.env ?? process.env;
  const roots: ReadonlyArray<[SkillSource, string]> = [
    ["ringko", ringkoRoot(env)],
    ["agents", agentsRoot(env)],
  ];

  const found = new Map<string, Skill>();
  for (const [source, root] of roots) {
    for (const dirName of SKILLS_DIR_NAMES) {
      const base = join(root, dirName);
      for (const entry of listDirectories(base)) {
        const dir = join(base, entry);
        const skillFile = join(dir, SKILL_FILE_NAME);
        try {
          if (!statSync(skillFile).isFile()) continue;
        } catch {
          continue;
        }
        let text: string;
        try {
          text = readFileSync(skillFile, "utf8");
        } catch {
          continue;
        }
        const metadata = parseSkillFrontmatter(text) ?? { name: entry };
        if (!found.has(metadata.name)) {
          found.set(metadata.name, { ...metadata, dir, source });
        }
      }
    }
  }
  return [...found.values()];
}

const SINGLE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Create a ringko skill directory with a `SKILL.md`. */
export function createSkill(
  input: { name: string; description?: string; body?: string },
  env: NodeJS.ProcessEnv = process.env,
): Skill {
  const name = input.name.trim();
  if (!SINGLE_SEGMENT.test(name) || name === "." || name === "..") {
    throw new Error("Skill name must be a single path segment.");
  }
  const dir = join(ringkoRoot(env), "skills", name);
  mkdirSync(dir, { recursive: true });
  const lines = ["---", `name: ${name}`];
  if (input.description && input.description.trim().length > 0) lines.push(`description: ${input.description.trim()}`);
  lines.push("---", "");
  if (input.body && input.body.length > 0) lines.push(input.body);
  writeFileSync(join(dir, SKILL_FILE_NAME), `${lines.join("\n")}\n`);
  return { name, ...(input.description ? { description: input.description } : {}), dir, source: "ringko" };
}

/** Delete a skill directory; refuses paths outside the managed skills roots. */
export function removeSkill(dir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const target = resolve(dir);
  const inside = skillsDirs(env).some((root) => {
    const rel = relative(resolve(root), target);
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  });
  if (!inside) throw new Error("Refusing to delete a directory outside the skills roots.");
  try {
    if (!statSync(target).isDirectory()) return false;
  } catch {
    return false;
  }
  rmSync(target, { recursive: true, force: true });
  return true;
}
