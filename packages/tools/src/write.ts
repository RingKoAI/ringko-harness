import { stat } from "node:fs/promises";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { FileTracker } from "./file-tracker.ts";
import { alternateSpellings, resolveWriteTarget, type Workspace } from "./workspace.ts";
import { Sandbox } from "./sandbox.ts";
import { safeFileOperation, validateFileOperation } from "./file-operation.ts";

export interface WriteInput {
  path: string;
  content: string;
}

export interface WriteOutput {
  path: string;
  bytes: number;
  created: boolean;
  /** True: the file was written (its content changed). */
  changed: true;
}

function parseWrite(value: unknown): WriteInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'path'.");
  }
  if (typeof record.content !== "string") {
    throw new TypeError("Expected a string 'content'.");
  }
  validateFileOperation({ kind: "write", content: record.content });
  return { path: record.path, content: record.content };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Create or overwrite a UTF-8 text file, subject to sandbox and approval boundaries. */
export function createWriteTool(workspace: Workspace, tracker: FileTracker = new FileTracker(), sandbox: Sandbox = new Sandbox({ workspace: workspace.root })): ToolDefinition<WriteInput, WriteOutput> {
  return defineTool<WriteInput, WriteOutput>({
    name: "write",
    serialGroup: `files:${process.platform === "win32" ? workspace.root.toLowerCase() : workspace.root}`,
    taskAccess: "write",
    concurrency: "exclusive",
    description:
      "Atomically create or overwrite a regular UTF-8 file (up to 64 MiB). Overwrites and external targets require approval; writes outside sandbox-authorized roots are denied even when approved. Directory write access is required for atomic replacement.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    parseInput: parseWrite,
    async assessRisk({ path }) {
      const target = await resolveWriteTarget(workspace, path);
      const targetExists = await exists(target.absolute);
      const alternates = alternateSpellings(target);
      const extra = { targetExists, ...(alternates.length > 0 ? { alternates } : {}) };
      if (!target.insideWorkspace) {
        return { kind: "external_file", reason: `Write outside the workspace: ${target.absolute}.`, target: target.absolute, ...extra };
      }
      if (targetExists) {
        return { kind: "workspace_write", level: "medium", reason: `Overwrite ${target.relative}.`, target: target.absolute, ...extra };
      }
      return { kind: "workspace_write", level: "low", reason: `Create ${target.relative}.`, target: target.absolute, ...extra };
    },
    async execute({ path, content }, context) {
      const target = await resolveWriteTarget(workspace, path);
      if (context?.approvedTarget && context.approvedTarget !== target.absolute) throw new Error("Write target changed after approval; retry the call.");
      sandbox.assertWrite(target.absolute);
      context?.signal?.throwIfAborted();
      const result = await safeFileOperation(target.absolute, { kind: "write", content, expectAbsent: context?.approvedTargetExists === false }, context?.signal);
      tracker.record(target.absolute, result);
      return {
        path: target.insideWorkspace ? target.relative : target.absolute,
        bytes: result.bytes,
        created: result.created,
        changed: true,
      };
    },
  });
}
