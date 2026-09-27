import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

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
