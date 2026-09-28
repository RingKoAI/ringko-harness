import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
const MAX_PATH_CHARACTERS = 32768;
const MAX_NEW_PATH_DEPTH = 256;

/** A caller-supplied path resolved against the workspace root. */
export interface ResolvedTarget {
  /** Absolute, normalised path. */
  absolute: string;
  /** Path relative to the workspace root, using "/" separators. */
  relative: string;
  /** True when the target resolves inside the workspace root. */
  insideWorkspace: boolean;
}

/** A workspace boundary used to classify targets as internal or external. */
export interface Workspace {
  readonly root: string;
  resolve(input: string): ResolvedTarget;
}

/**
 * Create a lexical workspace boundary. Resolution is purely path-based, so
 * symlinks are not followed; callers that need stronger guarantees must
 * re-check the real path with `realpath` before acting.
 */
export function createWorkspace(root: string): Workspace {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new TypeError("Workspace root must be a non-empty path.");
  }
  const normalizedRoot = normalize(resolve(root));

  function resolveTarget(input: string): ResolvedTarget {
    if (typeof input !== "string" || input.trim().length === 0) {
      throw new TypeError("A target path is required.");
    }
    if (input.includes("\0") || input.length > MAX_PATH_CHARACTERS) throw new TypeError("Invalid path length or NUL byte.");
    const absolute = normalize(isAbsolute(input) ? input : resolve(normalizedRoot, input));
    const rel = relative(normalizedRoot, absolute);
    const insideWorkspace =
      rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    return {
      absolute,
      relative: rel.split(sep).join("/"),
      insideWorkspace,
    };
  }

  return { root: normalizedRoot, resolve: resolveTarget };
}

/** Resolve existing symlinks, including the nearest existing parent of new files. */
async function canonical(path: string, depth = 0): Promise<string> {
  if (depth > MAX_NEW_PATH_DEPTH) throw new Error("New path nesting limit exceeded.");
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent, depth + 1), basename(path));
  }
}
export async function resolveWriteTarget(workspace: Workspace, input: string): Promise<ResolvedTarget> {
  const lexical = workspace.resolve(input);
  const [root, absolute] = await Promise.all([canonical(workspace.root), canonical(lexical.absolute)]);
  const rel = relative(root, absolute);
  return { absolute, relative: rel.split(sep).join("/"), insideWorkspace: rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) };
}
