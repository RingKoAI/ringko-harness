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
 * A target resolved through the filesystem. `absolute` is the real path used
 * for I/O; `lexical` keeps the caller's spelling so deny rules cannot be
 * bypassed by addressing the same file through a link or a different spelling.
 */
export interface ResolvedPathTarget extends ResolvedTarget {
  /** Normalised absolute path supplied by the caller, before links resolve. */
  lexical: string;
  /** Every absolute spelling of this target, primary canonical path first. */
  spellings: string[];
  /** False when the real location could not be determined. */
  resolved: boolean;
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
function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function spellings(lexical: string, absolute: string): string[] {
  return lexical === absolute ? [absolute] : [absolute, lexical];
}

/** Spellings to expose to restrictive permission rules, excluding the primary target. */
export function alternateSpellings(target: ResolvedPathTarget): string[] {
  return target.spellings.filter(spelling => spelling !== target.absolute);
}

export async function resolveWriteTarget(workspace: Workspace, input: string): Promise<ResolvedPathTarget> {
  const lexical = workspace.resolve(input);
  const [root, absolute] = await Promise.all([canonical(workspace.root), canonical(lexical.absolute)]);
  const rel = relative(root, absolute);
  return {
    absolute,
    relative: rel.split(sep).join("/"),
    insideWorkspace: isWithin(root, absolute),
    lexical: lexical.absolute,
    spellings: spellings(lexical.absolute, absolute),
    resolved: true,
  };
}

/**
 * Resolve a path that may or may not exist, following links as far as the
 * filesystem allows. A missing leaf is resolved through its nearest existing
 * parent, so a new file cannot inherit the classification of a link that does
 * not exist yet. Unresolvable paths are reported as external rather than
 * silently trusted as workspace-internal.
 */
async function canonicalBestEffort(path: string, depth = 0): Promise<{ path: string; resolved: boolean }> {
  if (depth > MAX_NEW_PATH_DEPTH) return { path, resolved: false };
  try {
    return { path: await realpath(path), resolved: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { path, resolved: false };
    const parent = dirname(path);
    if (parent === path) return { path, resolved: false };
    const resolved = await canonicalBestEffort(parent, depth + 1);
    return { path: join(resolved.path, basename(path)), resolved: resolved.resolved };
  }
}

/** Resolve a read/search target through links and classify it against the real workspace root. */
export async function resolvePathTarget(workspace: Workspace, input: string): Promise<ResolvedPathTarget> {
  const lexical = workspace.resolve(input);
  const [root, target] = await Promise.all([canonicalBestEffort(workspace.root), canonicalBestEffort(lexical.absolute)]);
  const insideWorkspace = root.resolved && target.resolved && isWithin(root.path, target.path);
  const rel = root.resolved ? relative(root.path, target.path) : lexical.relative;
  return {
    absolute: target.path,
    relative: rel.split(sep).join("/"),
    insideWorkspace,
    lexical: lexical.absolute,
    spellings: spellings(lexical.absolute, target.path),
    resolved: root.resolved && target.resolved,
  };
}
