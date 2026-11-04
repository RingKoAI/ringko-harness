import { isAbsolute, relative, sep } from "node:path";

/** A plain JSON-like object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `target` is `root` or lives below it after lexical resolution.
 * `root` and `target` should already be absolute; callers that follow symlinks
 * must canonicalize both first.
 */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
