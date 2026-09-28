// Ambient instruction files (AGENTS.md / CLAUDE.md), global + project.
//
// Mirrors opencode's rule: one global file (first existing wins), then the
// project's files found by walking up from the workspace; the first instruction
// file type with any match wins so ancestor files are not stacked.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { agentsRoot, findProjectRoot, ringkoRoot } from "./paths.ts";

export const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;

export type InstructionScope = "global" | "project";

export interface InstructionFile {
  path: string;
  content: string;
  scope: InstructionScope;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Collect `file` from `from` up to `stop` (inclusive), nearest first. */
function findUp(file: string, from: string, stop: string): string[] {
  const out: string[] = [];
  const end = resolve(stop);
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, file);
    if (isFile(candidate)) out.push(candidate);
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
}

/** Discover ambient instruction files: one global file, then project files. */
export function loadInstructions(options: LoadInstructionsOptions = {}): InstructionFile[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const files: InstructionFile[] = [];

  for (const candidate of [join(ringkoRoot(env), "AGENTS.md"), join(agentsRoot(env), "AGENTS.md")]) {
    if (isFile(candidate)) {
      files.push({ path: candidate, content: read(candidate), scope: "global" });
      break;
    }
  }

  const root = findProjectRoot(cwd, env) ?? resolve(cwd);
  for (const name of INSTRUCTION_FILE_NAMES) {
    const matches = findUp(name, cwd, root);
    if (matches.length > 0) {
      for (const path of matches) files.push({ path, content: read(path), scope: "project" });
      break;
    }
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
