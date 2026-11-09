import { isAbsolute, relative, resolve, sep, win32, posix } from "node:path";
import { SEARCH_LIMITS } from "./limits.ts";

/** A pattern may filter a root, never choose a second unapproved root. */
export function validateSearchGlob(pattern: string): string {
  if (!pattern.trim() || pattern.length > SEARCH_LIMITS.patternCharacters || pattern.includes("\0")) throw new TypeError("Invalid search glob length or NUL byte.");
  if (posix.isAbsolute(pattern) || win32.isAbsolute(pattern) || /^[A-Za-z]:/.test(pattern) || /(^|[\\/,{(])\.\.(?=$|[\\/},)])/.test(pattern)) {
    throw new TypeError("Search patterns must stay relative to their approved root; choose the directory with path instead.");
  }
  return pattern;
}

export function withinSearchRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function searchCandidate(root: string, match: string): string {
  const candidate = resolve(root, match);
  if (!withinSearchRoot(root, candidate)) throw new Error("Search result escaped its approved root.");
  return candidate;
}
