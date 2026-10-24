import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { resolveWriteTarget, type Workspace } from "./workspace.ts";

export const TREE_LIMITS = Object.freeze({ defaultDepth: 3, maxDepth: 16, defaultEntries: 500, maxEntries: 2000, scannedEntries: 20_000, outputCharacters: 131_072, footerCharacters: 160, entryOverhead: 160, excludeNames: 64, nameCharacters: 255, pathCharacters: 32768 });
export const TREE_DEFAULT_EXCLUDES = [".git", "node_modules", "dist", "build", "coverage", "target", ".next", ".cache", ".venv", "venv", "__pycache__"] as const;

export interface TreeInput {
  path?: string;
  max_depth?: number;
  max_entries?: number;
  directories_only?: boolean;
  include_hidden?: boolean;
  /** Exact entry names; overrides the default exclusion list when supplied. */
  exclude?: string[];
}
export interface TreeEntry {
  /** Relative to the requested tree root, with platform separators normalized. */
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  depth: number;
  children_truncated?: boolean;
  error?: string;
}
type TruncationReason = "max_depth" | "max_entries" | "scan_limit" | "output_limit" | "io_error";
export interface TreeOutput {
  path: string;
  tree: string;
  entries: TreeEntry[];
  directories: number;
  files: number;
  symlinks: number;
  other: number;
  truncated: boolean;
  truncation_reasons?: TruncationReason[];
}

function parseTree(value: unknown): TreeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a tree input object.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !["path", "max_depth", "max_entries", "directories_only", "include_hidden", "exclude"].includes(key))) throw new TypeError("Unexpected tree input field.");
  const input: TreeInput = {};
  if (data.path !== undefined) {
    if (typeof data.path !== "string" || !data.path.trim() || data.path.includes("\0") || data.path.length > TREE_LIMITS.pathCharacters) throw new TypeError("Invalid tree path.");
    input.path = data.path;
  }
  for (const [key, minimum, maximum] of [["max_depth", 0, TREE_LIMITS.maxDepth], ["max_entries", 1, TREE_LIMITS.maxEntries]] as const) {
    const value = data[key];
    if (value !== undefined) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${key} must be an integer from ${minimum} to ${maximum}.`);
      input[key] = value;
    }
  }
  for (const key of ["directories_only", "include_hidden"] as const) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== "boolean") throw new TypeError(`${key} must be boolean.`);
      input[key] = data[key];
    }
  }
  if (data.exclude !== undefined) {
    if (!Array.isArray(data.exclude) || data.exclude.length > TREE_LIMITS.excludeNames || data.exclude.some(name => typeof name !== "string" || !name || name.length > TREE_LIMITS.nameCharacters || name === "." || name === ".." || /[\\/\0]/.test(name))) throw new TypeError(`exclude must contain at most ${TREE_LIMITS.excludeNames} nonempty entry names without path separators.`);
    input.exclude = data.exclude as string[];
  }
  return input;
}

function contained(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

/** Escape filenames so control characters and newlines cannot forge tree rows. */
function label(value: string): string { return JSON.stringify(value).slice(1, -1); }
function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "DIRECTORY_CHANGED";
}
function compareNames(a: { name: string; directory: boolean }, b: { name: string; directory: boolean }): number {
  return Number(b.directory) - Number(a.directory) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** Native directory metadata traversal. No shell, OS tree executable or file-content reads. */
export function createTreeTool(workspace: Workspace): ToolDefinition<TreeInput, TreeOutput> {
  return defineTool({
    name: "tree",
    taskAccess: "read",
    description: "Show a directory tree using native filesystem APIs, not a shell or system tree command. Use this tool for directory structure instead of shell. Defaults: workspace root, depth 3, 500 entries; skips hidden entries and common dependency/build directories. Symlinks are shown but not traversed. Outside-workspace targets require approval. exclude replaces the default list with exact entry names.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_depth: { type: "integer", minimum: 0, maximum: TREE_LIMITS.maxDepth },
        max_entries: { type: "integer", minimum: 1, maximum: TREE_LIMITS.maxEntries },
        directories_only: { type: "boolean" },
        include_hidden: { type: "boolean" },
        exclude: { type: "array", maxItems: TREE_LIMITS.excludeNames, items: { type: "string", minLength: 1, maxLength: TREE_LIMITS.nameCharacters } },
      },
      additionalProperties: false,
    },
    parseInput: parseTree,
    async assessRisk(input) {
      const target = await resolveWriteTarget(workspace, input.path ?? ".");
      return { kind: target.insideWorkspace ? "workspace_file" : "external_file", reason: `List directory tree ${target.insideWorkspace ? target.relative || "." : target.absolute}.`, target: target.absolute };
    },
    async execute(input, context) {
      context?.signal?.throwIfAborted();
      const target = await resolveWriteTarget(workspace, input.path ?? ".");
      if (context?.approvedTarget && context.approvedTarget !== target.absolute) throw new Error("Tree target changed after approval; retry the call.");
      const rootInfo = await lstat(target.absolute);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new TypeError("tree path must resolve to a directory.");
      const shown = target.insideWorkspace ? target.relative || "." : target.absolute.split(sep).join("/");
      const lines = [label(shown)];
      const entries: TreeEntry[] = [];
      const reasons = new Set<TruncationReason>();
      const depthLimit = input.max_depth ?? TREE_LIMITS.defaultDepth;
      const entryLimit = input.max_entries ?? TREE_LIMITS.defaultEntries;
      const exclusions = new Set((input.exclude ?? TREE_DEFAULT_EXCLUDES).map(name => process.platform === "win32" ? name.toLowerCase() : name));
      let scanned = 0;
      let characters = JSON.stringify(shown).length * 2;
      let stopped = false;

      const list = async (path: string) => {
        context?.signal?.throwIfAborted();
        const before = await lstat(path, { bigint: true });
        const canonical = await realpath(path);
        if (!before.isDirectory() || before.isSymbolicLink() || !contained(target.absolute, canonical) || relative(path, canonical) !== "") throw new Error("Tree directory changed before traversal.");
        const directory = await opendir(path);
        const children: { name: string; directory: boolean; symlink: boolean }[] = [];
        try {
          for (;;) {
            context?.signal?.throwIfAborted();
            if (scanned >= TREE_LIMITS.scannedEntries) { reasons.add("scan_limit"); break; }
            const child = await directory.read();
            if (!child) break;
            scanned++;
            if ((!input.include_hidden && child.name.startsWith(".")) || exclusions.has(process.platform === "win32" ? child.name.toLowerCase() : child.name)) continue;
            children.push({ name: child.name, directory: child.isDirectory() && !child.isSymbolicLink(), symlink: child.isSymbolicLink() });
          }
        } finally { await directory.close(); }
        // Node has no portable descriptor-relative traversal: reject links and
        // recheck path/identity around each directory read before using its names.
        const after = await lstat(path, { bigint: true });
        if (after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || relative(canonical, await realpath(path)) !== "") throw new Error("Tree directory changed during traversal.");
        return children.sort(compareNames);
      };

      const walk = async (path: string, display: string, prefix: string, depth: number): Promise<void> => {
        if (depth >= depthLimit) { reasons.add("max_depth"); return; }
        const candidates = await list(path);
        const children = input.directories_only ? candidates.filter(child => child.directory || child.symlink) : candidates;
        for (let index = 0; index < children.length; index++) {
          context?.signal?.throwIfAborted();
          if (entries.length >= entryLimit) { reasons.add("max_entries"); stopped = true; return; }
          const child = children[index];
          const absolute = join(path, child.name);
          const childPath = display ? `${display}/${child.name}` : child.name;
          const entry: TreeEntry = { path: childPath, type: "other", depth: depth + 1 };
          try {
            const info = await lstat(absolute);
            entry.type = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
          } catch (error) { entry.error = errorCode(error); reasons.add("io_error"); }
          if (input.directories_only && entry.type !== "directory" && entry.type !== "symlink" && !entry.error) continue;
          const last = index === children.length - 1;
          const suffix = entry.type === "directory" ? "/" : entry.type === "symlink" ? " [symlink; not followed]" : "";
          const line = `${prefix}${last ? "└── " : "├── "}${label(child.name)}${suffix}${entry.error ? ` [${entry.error}]` : ""}`;
          const cost = JSON.stringify(line).length + JSON.stringify(entry).length + TREE_LIMITS.entryOverhead;
          if (characters + cost > TREE_LIMITS.outputCharacters - TREE_LIMITS.footerCharacters) { reasons.add("output_limit"); stopped = true; return; }
          characters += cost;
          entries.push(entry); lines.push(line);
          const lineIndex = lines.length - 1;
          if (entry.type === "directory") {
            if (depth + 1 >= depthLimit) { entry.children_truncated = true; reasons.add("max_depth"); lines[lineIndex] += " [depth limit]"; }
            else if (scanned < TREE_LIMITS.scannedEntries) {
              try { await walk(absolute, childPath, `${prefix}${last ? "    " : "│   "}`, depth + 1); }
              catch (error) {
                context?.signal?.throwIfAborted();
                entry.error = errorCode(error);
                entry.children_truncated = true;
                reasons.add("io_error");
                lines[lineIndex] += ` [${entry.error}]`;
              }
              if (stopped) entry.children_truncated = true;
            } else entry.children_truncated = true;
          }
          if (stopped) return;
        }
      };
      await walk(target.absolute, "", "", 0);
      context?.signal?.throwIfAborted();
      if (reasons.size) lines.push(`… [truncated: ${[...reasons].join(", ")}]`);
      return {
        path: shown, tree: lines.join("\n"), entries,
        directories: entries.filter(entry => entry.type === "directory").length,
        files: entries.filter(entry => entry.type === "file").length,
        symlinks: entries.filter(entry => entry.type === "symlink").length,
        other: entries.filter(entry => entry.type === "other").length,
        truncated: reasons.size > 0,
        ...(reasons.size ? { truncation_reasons: [...reasons] } : {}),
      };
    },
  });
}
