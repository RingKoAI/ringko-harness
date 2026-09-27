import { readFile, readdir, stat } from "node:fs/promises";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { FileTracker } from "./file-tracker.ts";
import type { Workspace } from "./workspace.ts";

const MAX_BYTES = 1_000_000;
const MAX_ENTRIES = 1000;
const DEFAULT_LIMIT = 2000;

export interface ReadInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadOutput {
  path: string;
  content?: string;
  entries?: string[];
  truncated?: boolean;
  /** Set when the file changed on disk since it was last read. */
  notice?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  return value as Record<string, unknown>;
}

function parseRead(value: unknown): ReadInput {
  const record = asRecord(value);
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'path'.");
  }
  const input: ReadInput = { path: record.path };
  if (record.offset !== undefined) {
    if (typeof record.offset !== "number" || !Number.isInteger(record.offset) || record.offset < 0) {
      throw new TypeError("'offset' must be a non-negative integer.");
    }
    input.offset = record.offset;
  }
  if (record.limit !== undefined) {
    if (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1) {
      throw new TypeError("'limit' must be a positive integer.");
    }
    input.limit = record.limit;
  }
  return input;
}

function addLineNumbers(lines: readonly string[], start: number): string {
  return lines.map((line, index) => `${String(start + index + 1).padStart(6, " ")}→${line}`).join("\n");
}

/** Read a text file (line-numbered) or list a directory. */
export function createReadTool(workspace: Workspace, tracker: FileTracker = new FileTracker()): ToolDefinition<ReadInput, ReadOutput> {
  return defineTool<ReadInput, ReadOutput>({
    name: "read",
    description:
      "Read a UTF-8 text file with line numbers, or list a directory. Targets outside the workspace require approval.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    parseInput: parseRead,
    assessRisk({ path }) {
      const target = workspace.resolve(path);
      return target.insideWorkspace
        ? { kind: "workspace_file", reason: `Read workspace path ${target.relative}.`, target: target.absolute }
        : { kind: "external_file", reason: `Read outside the workspace: ${target.absolute}.`, target: target.absolute };
    },
    async execute({ path, offset, limit }) {
      const target = workspace.resolve(path);
      const shown = target.insideWorkspace ? target.relative : target.absolute;
      const info = await stat(target.absolute);

      if (info.isDirectory()) {
        const all = (await readdir(target.absolute)).sort();
        return {
          path: shown,
          entries: all.slice(0, MAX_ENTRIES),
          ...(all.length > MAX_ENTRIES ? { truncated: true } : {}),
        };
      }

      const changed = tracker.changedSinceLastRead(target.absolute, info);
      const raw = await readFile(target.absolute, "utf8");
      const truncatedByBytes = raw.length > MAX_BYTES;
      const text = truncatedByBytes ? raw.slice(0, MAX_BYTES) : raw;
      const lines = text.split("\n");
      const start = offset ?? 0;
      const count = limit ?? DEFAULT_LIMIT;
      const slice = lines.slice(start, start + count);
      const truncated = truncatedByBytes || lines.length > start + count;
      tracker.record(target.absolute, info);
      return {
        path: shown,
        content: addLineNumbers(slice, start),
        ...(truncated ? { truncated } : {}),
        ...(changed ? { notice: `${shown} changed since it was last read; re-read before editing.` } : {}),
      };
    },
  });
}
