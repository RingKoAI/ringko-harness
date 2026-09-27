import { readFile, stat, writeFile } from "node:fs/promises";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { FileTracker } from "./file-tracker.ts";
import type { Workspace } from "./workspace.ts";

export interface EditInput {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface EditOutput {
  path: string;
  replacements: number;
  /** True: the file was changed (and any prior read of it is stale). */
  changed: true;
}

function parseEdit(value: unknown): EditInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'path'.");
  }
  if (typeof record.old_string !== "string" || record.old_string.length === 0) {
    throw new TypeError("Expected a non-empty string 'old_string'.");
  }
  if (typeof record.new_string !== "string") {
    throw new TypeError("Expected a string 'new_string'.");
  }
  let replaceAll = false;
  if (record.replace_all !== undefined) {
    if (typeof record.replace_all !== "boolean") throw new TypeError("'replace_all' must be a boolean.");
    replaceAll = record.replace_all;
  }
  return { path: record.path, old_string: record.old_string, new_string: record.new_string, replace_all: replaceAll };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Replace an exact string in a file. External targets require approval. */
export function createEditTool(workspace: Workspace, tracker: FileTracker = new FileTracker()): ToolDefinition<EditInput, EditOutput> {
  return defineTool<EditInput, EditOutput>({
    name: "edit",
    concurrency: "exclusive",
    description:
      "Replace an exact string in a file. `old_string` must appear; set `replace_all` to change every occurrence. External targets require approval.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
    parseInput: parseEdit,
    assessRisk({ path }) {
      const target = workspace.resolve(path);
      return target.insideWorkspace
        ? { kind: "workspace_write", reason: `Edit ${target.relative}.`, target: target.absolute }
        : { kind: "external_file", reason: `Edit outside the workspace: ${target.absolute}.`, target: target.absolute };
    },
    async execute({ path, old_string, new_string, replace_all }) {
      const target = workspace.resolve(path);
      const content = await readFile(target.absolute, "utf8");
      const occurrences = countOccurrences(content, old_string);
      if (occurrences === 0) {
        throw new Error(`'old_string' was not found in ${target.insideWorkspace ? target.relative : target.absolute}.`);
      }
      if (occurrences > 1 && !replace_all) {
        throw new Error(`'old_string' occurs ${occurrences} times; set replace_all or provide a more specific string.`);
      }
      const updated = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);
      await writeFile(target.absolute, updated, "utf8");
      tracker.record(target.absolute, await stat(target.absolute));
      return {
        path: target.insideWorkspace ? target.relative : target.absolute,
        replacements: replace_all ? occurrences : 1,
        changed: true,
      };
    },
  });
}
