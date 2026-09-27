import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { FileTracker } from "./file-tracker.ts";
import type { Workspace } from "./workspace.ts";

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
  return { path: record.path, content: record.content };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Create or overwrite a UTF-8 text file; overwrites and external targets require approval. */
export function createWriteTool(workspace: Workspace, tracker: FileTracker = new FileTracker()): ToolDefinition<WriteInput, WriteOutput> {
  return defineTool<WriteInput, WriteOutput>({
    name: "write",
    concurrency: "exclusive",
    description:
      "Create or overwrite a UTF-8 text file. Overwriting an existing file, or writing outside the workspace, requires approval.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    parseInput: parseWrite,
    async assessRisk({ path }) {
      const target = workspace.resolve(path);
      if (!target.insideWorkspace) {
        return { kind: "external_file", reason: `Write outside the workspace: ${target.absolute}.`, target: target.absolute };
      }
      if (await exists(target.absolute)) {
        return { kind: "workspace_write", level: "medium", reason: `Overwrite ${target.relative}.`, target: target.absolute };
      }
      return { kind: "workspace_write", level: "low", reason: `Create ${target.relative}.`, target: target.absolute };
    },
    async execute({ path, content }) {
      const target = workspace.resolve(path);
      const existed = await exists(target.absolute);
      await mkdir(dirname(target.absolute), { recursive: true });
      await writeFile(target.absolute, content, "utf8");
      tracker.record(target.absolute, await stat(target.absolute));
      return {
        path: target.insideWorkspace ? target.relative : target.absolute,
        bytes: Buffer.byteLength(content, "utf8"),
        created: !existed,
        changed: true,
      };
    },
  });
}
