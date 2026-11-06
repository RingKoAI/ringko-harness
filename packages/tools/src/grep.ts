import { lstat, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { pathRisk } from "./path-access.ts";
import { resolvePathTarget, type Workspace } from "./workspace.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE_CHARACTERS = 2_000;
/** Directory names skipped while walking, so bundled/vendored trees are not scanned. */
export const GREP_IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt",
  ".turbo", ".cache", ".parcel-cache", "coverage", "target", "vendor", ".venv", "venv", "__pycache__", ".idea",
]);

export type GrepOutputMode = "content" | "files_with_matches" | "count";

export interface GrepInput {
  pattern: string;
  /** Workspace-relative or absolute file or directory; defaults to the workspace root. */
  path?: string;
  /** Glob limiting scanned files for directory targets (default: all files). */
  glob?: string;
  case_insensitive?: boolean;
  output_mode?: GrepOutputMode;
  /** Number of results to skip before collecting (default: 0). */
  offset?: number;
  head_limit?: number;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepCount {
  file: string;
  count: number;
}

export interface GrepOutput {
  base: string;
  output_mode: GrepOutputMode;
  matches?: GrepMatch[];
  files?: string[];
  counts?: GrepCount[];
  /** Set only when at least one more result exists beyond this page. */
  truncated?: boolean;
  /** Offset to pass next when `truncated` is set. */
  next_offset?: number;
}

const OUTPUT_MODES = new Set<GrepOutputMode>(["content", "files_with_matches", "count"]);

function parseGrep(value: unknown): GrepInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !["pattern", "path", "glob", "case_insensitive", "output_mode", "offset", "head_limit"].includes(key))) {
    throw new TypeError("Unexpected grep field.");
  }
  if (typeof record.pattern !== "string" || record.pattern.length === 0) throw new TypeError("Expected a non-empty 'pattern'.");
  const input: GrepInput = { pattern: record.pattern };
  if (record.path !== undefined) {
    if (typeof record.path !== "string" || record.path.trim().length === 0) throw new TypeError("'path' must be a non-empty string.");
    input.path = record.path;
  }
  if (record.glob !== undefined) {
    if (typeof record.glob !== "string" || record.glob.trim().length === 0) throw new TypeError("'glob' must be a non-empty string.");
    input.glob = record.glob;
  }
  if (record.case_insensitive !== undefined) {
    if (typeof record.case_insensitive !== "boolean") throw new TypeError("'case_insensitive' must be a boolean.");
    input.case_insensitive = record.case_insensitive;
  }
  if (record.output_mode !== undefined) {
    if (typeof record.output_mode !== "string" || !OUTPUT_MODES.has(record.output_mode as GrepOutputMode)) {
      throw new TypeError("'output_mode' must be content, files_with_matches or count.");
    }
    input.output_mode = record.output_mode as GrepOutputMode;
  }
  if (record.offset !== undefined) {
    if (typeof record.offset !== "number" || !Number.isSafeInteger(record.offset) || record.offset < 0) {
      throw new TypeError("'offset' must be a non-negative integer.");
    }
    input.offset = record.offset;
  }
  if (record.head_limit !== undefined) {
    if (typeof record.head_limit !== "number" || !Number.isInteger(record.head_limit) || record.head_limit < 1) {
      throw new TypeError("'head_limit' must be a positive integer.");
    }
    input.head_limit = record.head_limit;
  }
  return input;
}

function isIgnored(relativePath: string): boolean {
  for (const segment of relativePath.split(/[\\/]+/)) {
    if (GREP_IGNORED_DIRECTORIES.has(segment)) return true;
  }
  return false;
}

function clampLine(text: string): string {
  return text.length > MAX_LINE_CHARACTERS ? `${text.slice(0, MAX_LINE_CHARACTERS)}…` : text;
}

/** Search file contents with a regular expression; file or directory targets, ripgrep-style output modes. */
export function createGrepTool(workspace: Workspace): ToolDefinition<GrepInput, GrepOutput> {
  return defineTool<GrepInput, GrepOutput>({
    name: "grep",
    taskAccess: "read",
    description:
      "Search file contents with a regular expression. `path` may be a file or directory (default: workspace root). " +
      "`glob` limits scanned files for directory targets. `output_mode` selects content (default), files_with_matches, or count. " +
      "`offset` skips results and `head_limit` caps the page; `next_offset` and `truncated` are set only when more results exist. " +
      "Vendor/build directories (node_modules, .git, dist, …), symlinked entries, binary files and files over 1 MiB are skipped. External targets require approval.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        case_insensitive: { type: "boolean" },
        output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
        offset: { type: "integer", minimum: 0 },
        head_limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    parseInput: parseGrep,
    async assessRisk({ path }) {
      return pathRisk(await resolvePathTarget(workspace, path ?? "."), "Grep");
    },
    async execute({ pattern, path, glob, case_insensitive, output_mode, offset, head_limit }, context) {
      const source = path ?? ".";
      const target = await resolvePathTarget(workspace, source);
      if (!target.resolved) throw new TypeError(`Cannot resolve ${target.absolute} safely; retry the call.`);
      if (context?.approvedTarget && context.approvedTarget !== target.absolute) throw new Error("Grep target changed after approval; retry the call.");
      const mode = output_mode ?? "content";
      const skip = offset ?? 0;
      const limit = Math.min(head_limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, case_insensitive ? "i" : "");
      } catch (error) {
        throw new Error(`Invalid regular expression: ${(error as Error).message}`);
      }

      let info;
      try {
        info = await stat(target.absolute);
      } catch {
        throw new Error(`Path not found: ${target.absolute}`);
      }
      const base = target.insideWorkspace ? (target.relative || ".") : target.absolute;

      // A file target is searched directly; a directory target is walked with the glob filter.
      const files: string[] = [];
      if (info.isFile()) {
        files.push(base);
      } else if (info.isDirectory()) {
        const scanner = new Bun.Glob(glob ?? "**/*").scan({ cwd: target.absolute, dot: false, onlyFiles: true, followSymlinks: false });
        for await (const relative of scanner) {
          context?.signal?.throwIfAborted();
          const display = relative.replace(/\\/g, "/");
          if (isIgnored(display)) continue;
          files.push(display);
          if (files.length >= MAX_FILES) break;
        }
      } else {
        throw new Error("Path is neither a file nor a directory.");
      }

      const readAndScan = async (display: string): Promise<{ matches: GrepMatch[]; count: number } | undefined> => {
        const absolute = info.isFile() ? target.absolute : join(target.absolute, display);
        let text: string;
        try {
          const entry = await lstat(absolute);
          if (!entry.isFile()) return undefined;
          const raw = await readFile(absolute, { encoding: "utf8", signal: context?.signal });
          if (raw.length > MAX_FILE_BYTES || raw.includes("\u0000")) return undefined;
          text = raw;
        } catch {
          context?.signal?.throwIfAborted();
          return undefined;
        }
        const lines = text.split("\n");
        const found: GrepMatch[] = [];
        for (let index = 0; index < lines.length; index += 1) {
          if (regex.test(lines[index])) found.push({ file: display, line: index + 1, text: clampLine(lines[index]) });
        }
        return { matches: found, count: found.length };
      };

      const revalidate = async () => {
        if ((await resolvePathTarget(workspace, source)).absolute !== target.absolute) {
          throw new Error("Grep target changed while searching; retry the call.");
        }
      };

      if (mode === "content") {
        const matches: GrepMatch[] = [];
        let seen = 0;
        let truncated = false;
        scan: for (const display of files) {
          context?.signal?.throwIfAborted();
          const scanned = await readAndScan(display);
          if (!scanned) continue;
          for (const match of scanned.matches) {
            if (seen < skip) { seen += 1; continue; }
            if (matches.length >= limit) { truncated = true; break scan; }
            matches.push(match);
            seen += 1;
          }
        }
        await revalidate();
        return {
          base,
          output_mode: mode,
          matches,
          ...(truncated ? { truncated: true, next_offset: skip + matches.length } : {}),
        };
      }

      const counts: GrepCount[] = [];
      let seen = 0;
      let truncated = false;
      for (const display of files) {
        context?.signal?.throwIfAborted();
        const scanned = await readAndScan(display);
        if (!scanned || scanned.count === 0) continue;
        if (seen < skip) { seen += 1; continue; }
        if (counts.length >= limit) { truncated = true; break; }
        counts.push({ file: display, count: scanned.count });
        seen += 1;
      }
      await revalidate();
      const page = truncated ? { truncated: true, next_offset: skip + counts.length } : {};
      if (mode === "files_with_matches") {
        return { base, output_mode: mode, files: counts.map(entry => entry.file), ...page };
      }
      return { base, output_mode: mode, counts, ...page };
    },
  });
}
