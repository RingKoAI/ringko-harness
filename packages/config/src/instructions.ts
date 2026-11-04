// Ambient instruction files (AGENTS.md / CLAUDE.md), global + project.
//
// Mirrors opencode's rule: one global file (first existing wins), then the
// project's files found by walking up from the workspace. The first file type
// with matches wins, so AGENTS.md and CLAUDE.md are not stacked together.
import { closeSync, fstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { agentsRoot, findProjectRoot, ringkoRoot } from "./paths.ts";

export const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;
export const INSTRUCTION_LIMITS = { fileBytes: 256 * 1024, totalBytes: 1024 * 1024, files: 64 } as const;

export type InstructionScope = "global" | "project";

export interface InstructionFile {
  path: string;
  content: string;
  scope: InstructionScope;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw new Error(`Cannot inspect instruction file "${path}".`);
  }
}

function read(path: string): string {
  let descriptor: number;
  try { descriptor = openSync(path, "r"); }
  catch { throw new Error(`Cannot read instruction file "${path}".`); }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`Instruction path is not a regular file: "${path}".`);
    if (stat.size > INSTRUCTION_LIMITS.fileBytes) throw new Error(`Instruction file exceeds ${INSTRUCTION_LIMITS.fileBytes} bytes: "${path}".`);
    const buffer = Buffer.alloc(INSTRUCTION_LIMITS.fileBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(descriptor, buffer, size, buffer.length - size, size);
      if (!count) break;
      size += count;
    }
    if (size > INSTRUCTION_LIMITS.fileBytes) throw new Error(`Instruction file exceeds ${INSTRUCTION_LIMITS.fileBytes} bytes: "${path}".`);
    return buffer.subarray(0, size).toString("utf8");
  } finally { closeSync(descriptor); }
}

/** Collect `file` from `from` up to `stop` (inclusive), nearest first. */
function findUp(file: string, from: string, stop: string): string[] {
  const out: string[] = [];
  const end = resolve(stop);
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, file);
    if (isFile(candidate)) {
      if (out.length >= INSTRUCTION_LIMITS.files) throw new Error("Too many instruction files.");
      out.push(candidate);
    }
    if (dir === end) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

export interface LoadInstructionsOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Scan `AGENTS.md` under the workspace recursively (default true). */
  recursive?: boolean;
}

const IGNORED_SCAN_DIRS = new Set([".git", ".hg", ".svn", "node_modules", "dist", "build", "coverage", ".next", "target", "vendor"]);
const MAX_SCAN_DEPTH = 12;
const MAX_SCAN_DIRS = 4_096;

/** Breadth-first `AGENTS.md` discovery below the workspace. Symlinks are skipped. */
function scanAgentsFiles(root: string): string[] {
  const start = resolve(root);
  const out: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }];
  let directories = 0;
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (++directories > MAX_SCAN_DIRS) throw new Error("Instruction scan exceeds the directory limit.");
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isFile() && entry.name === "AGENTS.md") out.push(join(dir, entry.name));
      if (entry.isDirectory() && depth < MAX_SCAN_DEPTH && !entry.name.startsWith(".") && !IGNORED_SCAN_DIRS.has(entry.name)) {
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
      }
    }
  }
  return out;
}

/** Discover ambient instruction files: one global file, then project files. */
export function loadInstructions(options: LoadInstructionsOptions = {}): InstructionFile[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const files: InstructionFile[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  const append = (path: string, scope: InstructionScope) => {
    const canonical = realpathSync(path);
    const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    if (seen.has(key)) return;
    if (files.length >= INSTRUCTION_LIMITS.files) throw new Error("Too many instruction files.");
    const content = read(canonical);
    bytes += Buffer.byteLength(content);
    if (bytes > INSTRUCTION_LIMITS.totalBytes) throw new Error(`Instruction context exceeds ${INSTRUCTION_LIMITS.totalBytes} bytes.`);
    seen.add(key);
    files.push({ path, content, scope });
  };

  for (const candidate of [join(ringkoRoot(env), "AGENTS.md"), join(agentsRoot(env), "AGENTS.md")]) {
    if (isFile(candidate)) {
      append(candidate, "global");
      break;
    }
  }

  const root = findProjectRoot(cwd, env) ?? resolve(cwd);
  for (const name of INSTRUCTION_FILE_NAMES) {
    const matches = findUp(name, cwd, root);
    if (matches.length > 0) {
      for (const path of matches) append(path, "project");
      break;
    }
  }

  // Nested project instructions are additive: the nearest/root rules above
  // keep precedence, while subdirectories can add local guidance.
  if (options.recursive !== false) {
    for (const path of scanAgentsFiles(cwd)) append(path, "project");
  }

  return files;
}

/** Concatenate discovered instructions for the system prompt. */
export function instructionsText(files: readonly InstructionFile[]): string {
  return files
    .filter((file) => file.content.trim().length > 0)
    .map((file) => `Instructions from: ${file.path}\n${file.content.trimEnd()}`)
    .join("\n\n");
}
