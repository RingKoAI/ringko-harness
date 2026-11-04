// Skill discovery from the user-level skill directories.
//
// A skill is a directory containing a `SKILL.md` whose YAML frontmatter declares
// at least a `name` (and usually a `description`). RingKo scans
// `~/.ringko/skills` and `~/.agents/skills` (and the singular `skill` alias);
// ringko-specific skills take precedence over shared ones with the same name.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { agentsRoot, ancestorSkillsDirs, findProjectRoot, projectSkillsDirs, RINGKO_DIR_NAME, ringkoRoot, SKILLS_DIR_NAMES, skillsDirs } from "./paths.ts";
import { loadPlugins, type LoadedPlugin } from "./plugins.ts";

export const SKILL_FILE_NAME = "SKILL.md";
const SKILL_METADATA_BYTES = 16 * 1024;

export type SkillSource = "project" | "ringko" | "agents";
export type SkillScope = "project" | "global";

export interface SkillMetadata {
  name: string;
  description?: string;
}

export interface Skill extends SkillMetadata {
  /** Absolute directory containing the SKILL.md. */
  dir: string;
  source: SkillSource;
  /** Project-level vs user-level. */
  scope: SkillScope;
  /** Plugin id when the skill came from a trusted plugin (`<plugin>:<name>`). */
  plugin?: string;
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
  /** Workspace used to locate a project root. */
  cwd?: string;
  /** Preloaded trusted plugins; when set, plugin directories are not discovered again. */
  plugins?: readonly LoadedPlugin[];
}

interface SkillRoot {
  dir: string;
  source: SkillSource;
  scope: SkillScope;
  plugin?: string;
}

function readSkillFile(skillFile: string): SkillMetadata | undefined {
  let text: string;
  try {
    const descriptor = openSync(skillFile, "r");
    try {
      const buffer = Buffer.alloc(SKILL_METADATA_BYTES);
      const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
      text = buffer.subarray(0, bytes).toString("utf8");
    } finally { closeSync(descriptor); }
  } catch {
    return undefined;
  }
  return parseSkillFrontmatter(text);
}

function loadSkill(root: SkillRoot, dir: string, fallbackName: string): Skill | undefined {
  const skillFile = join(dir, SKILL_FILE_NAME);
  try {
    if (!statSync(skillFile).isFile()) return undefined;
  } catch {
    return undefined;
  }
  const metadata = readSkillFile(skillFile) ?? { name: fallbackName };
  if (root.plugin) {
    const name = `${root.plugin}:${metadata.name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    return { ...metadata, name, dir, source: root.source, scope: root.scope, plugin: root.plugin };
  }
  return { ...metadata, dir, source: root.source, scope: root.scope };
}

/** Discover skills across project-level dirs (win) then the user-level roots. */
export function discoverSkills(options: DiscoverSkillsOptions = {}): Skill[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const roots: SkillRoot[] = [
    ...projectSkillsDirs(cwd, env).map((dir) => ({ dir, source: "project" as const, scope: "project" as const })),
    // Shared skills above a nested repository are workspace-level, not owned
    // by the inner project. Project-root skills still take precedence.
    ...ancestorSkillsDirs(cwd, env).map((dir) => ({
      dir,
      source: basename(dirname(dir)) === RINGKO_DIR_NAME ? "ringko" as const : "agents" as const,
      scope: "global" as const,
    })),
    ...SKILLS_DIR_NAMES.flatMap((name) => [
      { dir: join(ringkoRoot(env), name), source: "ringko" as const, scope: "global" as const },
      { dir: join(agentsRoot(env), name), source: "agents" as const, scope: "global" as const },
    ]),
    // Plugin skill directories are lowest precedence. Their names are
    // namespaced (`<plugin>:<skill>`) so they cannot shadow installed skills.
    ...(options.plugins ?? loadPlugins({ env, cwd }).plugins).flatMap(plugin => plugin.skillDirs.map(dir => ({
      dir,
      source: plugin.source,
      scope: plugin.scope,
      plugin: plugin.id,
    }))),
  ];
  const seenRoots = new Set<string>();
  const uniqueRoots = roots.filter((root) => {
    const key = `${root.plugin ?? ""}\0${resolve(root.dir)}`;
    if (seenRoots.has(key)) return false;
    seenRoots.add(key);
    return true;
  });

  const found = new Map<string, Skill>();
  for (const root of uniqueRoots) {
    const add = (skill: Skill | undefined): void => {
      if (skill && !found.has(skill.name)) found.set(skill.name, skill);
    };
    // A plugin's declared skill path may be one skill directory or a collection.
    if (root.plugin) {
      const direct = loadSkill(root, root.dir, basename(root.dir));
      if (direct) { add(direct); continue; }
    }
    for (const entry of listDirectories(root.dir)) add(loadSkill(root, join(root.dir, entry), entry));
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
  return { name, ...(input.description ? { description: input.description } : {}), dir, source: "ringko", scope: "global" };
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallTarget {
  scope: SkillInstallScope;
  /** Directory that holds installed skill directories. */
  root: string;
}

/** Global and project skill installation roots for a workspace. */
export function skillInstallTargets(options: DiscoverSkillsOptions = {}): SkillInstallTarget[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = findProjectRoot(cwd, env) ?? resolve(cwd);
  return [
    { scope: "global", root: join(ringkoRoot(env), "skills") },
    { scope: "project", root: join(projectRoot, RINGKO_DIR_NAME, "skills") },
  ];
}

const MAX_INSTALL_FILES = 256;
const MAX_INSTALL_DEPTH = 16;
const MAX_INSTALL_FILE_BYTES = 4 * 1024 * 1024;
const MAX_INSTALL_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_FILE_BYTES = 64 * 1024;

interface SkillSourceFile {
  relative: string;
  absolute: string;
}

function collectSkillSource(root: string): SkillSourceFile[] {
  const files: SkillSourceFile[] = [];
  let bytes = 0;
  const visit = (directory: string, prefix: string, depth: number): void => {
    if (depth > MAX_INSTALL_DEPTH) throw new Error("Skill source exceeds the maximum directory depth.");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = prefix.length === 0 ? entry.name : join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Skill sources may not contain symbolic links.");
      if (entry.isDirectory()) { visit(absolute, path, depth + 1); continue; }
      if (!entry.isFile()) throw new Error("Skill sources may contain only regular files and directories.");
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Skill sources may contain only regular files and directories.");
      if (stat.size > MAX_INSTALL_FILE_BYTES) throw new Error("A skill source file exceeds 4 MiB.");
      bytes += stat.size;
      if (bytes > MAX_INSTALL_BYTES) throw new Error("Skill source exceeds 8 MiB.");
      files.push({ relative: path, absolute });
      if (files.length > MAX_INSTALL_FILES) throw new Error("Skill source exceeds 256 files.");
    }
  };
  visit(root, "", 0);
  return files;
}

/** Copy one file without following a replaced symlink. */
function copySkillFile(source: string, destination: string): void {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const descriptor = openSync(source, constants.O_RDONLY | noFollow);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_INSTALL_FILE_BYTES) throw new Error("A skill source file changed during installation.");
    const data = readFileSync(descriptor);
    if (data.length > MAX_INSTALL_FILE_BYTES) throw new Error("A skill source file changed during installation.");
    writeFileSync(destination, data, { flag: "wx", mode: 0o600 });
  } finally { closeSync(descriptor); }
}

export interface InstallSkillOptions {
  /** Local skill directory containing SKILL.md. */
  source: string;
  scope: SkillInstallScope;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Install a local skill directory into the global or project skills root.
 * The whole source is validated before anything is written; the copy lands in
 * a temporary directory and is renamed into place, and existing skills are
 * never overwritten.
 */
export function installSkill(options: InstallSkillOptions): Skill {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const source = resolve(cwd, options.source);
  let sourceStat;
  try { sourceStat = lstatSync(source); } catch { throw new Error(`Skill source "${options.source}" does not exist.`); }
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) throw new Error("Skill source must be a directory, not a symbolic link.");
  const files = collectSkillSource(source);
  const skillFile = files.find(file => file.relative === SKILL_FILE_NAME);
  if (!skillFile) throw new Error(`Skill source must contain ${SKILL_FILE_NAME} at its root.`);
  if (statSync(skillFile.absolute).size > MAX_SKILL_FILE_BYTES) throw new Error("SKILL.md exceeds 64 KiB.");
  const metadata = parseSkillFrontmatter(readFileSync(skillFile.absolute, "utf8"));
  const name = metadata?.name ?? basename(source);
  if (!SINGLE_SEGMENT.test(name) || name === "." || name === "..") throw new Error("Skill name must be a single path segment.");
  const target = skillInstallTargets({ env, cwd }).find(entry => entry.scope === options.scope);
  if (!target) throw new Error("Unknown skill installation scope.");
  const destination = join(target.root, name);
  try {
    lstatSync(destination);
    throw new Error(`Skill "${name}" is already installed at ${destination}.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(target.root, { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(join(target.root, ".install-"));
  try {
    for (const file of files) {
      const destinationFile = join(temporary, file.relative);
      mkdirSync(dirname(destinationFile), { recursive: true, mode: 0o700 });
      copySkillFile(file.absolute, destinationFile);
    }
    renameSync(temporary, destination);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    name,
    ...(metadata?.description ? { description: metadata.description } : {}),
    dir: destination,
    source: options.scope === "project" ? "project" : "ringko",
    scope: options.scope,
  };
}

/** Delete a skill directory; refuses paths outside the managed skills roots. */
export function removeSkill(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): boolean {
  const target = resolve(dir);
  const roots = [...projectSkillsDirs(cwd, env), ...ancestorSkillsDirs(cwd, env), ...skillsDirs(env)];
  const inside = roots.some((root) => {
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
