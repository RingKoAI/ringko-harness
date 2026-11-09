import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { FileTracker } from "./file-tracker.ts";
import { alternateSpellings, resolveWriteTarget, type Workspace } from "./workspace.ts";
import { Sandbox } from "./sandbox.ts";
import { safeFileOperation, validateFileOperation } from "./file-operation.ts";

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
  validateFileOperation({ kind: "edit", oldString: record.old_string, newString: record.new_string, replaceAll: false });
  let replaceAll = false;
  if (record.replace_all !== undefined) {
    if (typeof record.replace_all !== "boolean") throw new TypeError("'replace_all' must be a boolean.");
    replaceAll = record.replace_all;
  }
  return { path: record.path, old_string: record.old_string, new_string: record.new_string, replace_all: replaceAll };
}

/** Replace an exact string in a file, subject to sandbox and approval boundaries. */
export function createEditTool(workspace: Workspace, tracker: FileTracker = new FileTracker(), sandbox: Sandbox = new Sandbox({ workspace: workspace.root })): ToolDefinition<EditInput, EditOutput> {
  return defineTool<EditInput, EditOutput>({
    name: "edit",
    serialGroup: `files:${process.platform === "win32" ? workspace.root.toLowerCase() : workspace.root}`,
    taskAccess: "write",
    concurrency: "exclusive",
    description:
      "Atomically replace a literal string in a regular file. Source and output are limited to 64 MiB; old/new arguments to 1,000,000 UTF-8 bytes and replacements to 1,000,000. `old_string` must appear; set `replace_all` to change every occurrence. External targets require sandbox authorization and approval.",
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
    async assessRisk({ path }) {
      const target = await resolveWriteTarget(workspace, path);
      const alternates = alternateSpellings(target);
      const extra = alternates.length > 0 ? { alternates } : {};
      return target.insideWorkspace
        ? { kind: "workspace_write", reason: `Edit ${target.relative}.`, target: target.absolute, ...extra }
        : { kind: "external_file", reason: `Edit outside the workspace: ${target.absolute}.`, target: target.absolute, ...extra };
    },
    async execute({ path, old_string, new_string, replace_all }, context) {
      const target = await resolveWriteTarget(workspace, path);
      if (context?.approvedTarget && context.approvedTarget !== target.absolute) throw new Error("Edit target changed after approval; retry the call.");
      sandbox.assertWrite(target.absolute);
      context?.signal?.throwIfAborted();
      const result = await safeFileOperation(target.absolute, { kind: "edit", oldString: old_string, newString: new_string, replaceAll: replace_all === true }, context?.signal);
      tracker.record(target.absolute, result);
      return {
        path: target.insideWorkspace ? target.relative : target.absolute,
        replacements: result.replacements,
        changed: true,
      };
    },
  });
}
