import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDefinition } from "@ringko-ai/harness";
import type { Workspace } from "./workspace.ts";

export interface ReadFileInput {
  path: string;
}

export interface ReadFileOutput {
  path: string;
  content: string;
}

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface WriteFileOutput {
  path: string;
  bytes: number;
}

export interface ListDirInput {
  path: string;
}

export interface ListDirOutput {
  path: string;
  entries: { name: string; kind: "file" | "directory" | "other" }[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  return value as Record<string, unknown>;
}

function parsePath(value: unknown): ReadFileInput {
  const record = asRecord(value);
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'path'.");
  }
  return { path: record.path };
}

function parseWriteInput(value: unknown): WriteFileInput {
  const record = asRecord(value);
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'path'.");
  }
  if (typeof record.content !== "string") {
    throw new TypeError("Expected a string 'content'.");
  }
  return { path: record.path, content: record.content };
}

function parseListInput(value: unknown): ListDirInput {
  const record = asRecord(value);
  if (record.path === undefined) {
    return { path: "." };
  }
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'path'.");
  }
  return { path: record.path };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const PATH_SCHEMA = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
  additionalProperties: false,
} as const;

/** Read a UTF-8 text file; external targets are classified as high risk. */
export function createReadFileTool(workspace: Workspace): ToolDefinition<ReadFileInput, ReadFileOutput> {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file. Targets outside the workspace require approval.",
    inputSchema: PATH_SCHEMA,
    parseInput: parsePath,
    assessRisk({ path }) {
      const target = workspace.resolve(path);
      return target.insideWorkspace
        ? { kind: "workspace_file", reason: `Read workspace file ${target.relative}.`, target: target.absolute }
        : { kind: "external_file", reason: `Read file outside the workspace: ${target.absolute}.`, target: target.absolute };
    },
    async execute({ path }) {
      const target = workspace.resolve(path);
      const content = await readFile(target.absolute, "utf8");
      return { path: target.insideWorkspace ? target.relative : target.absolute, content };
    },
  };
}

/** Write a UTF-8 text file; overwrites and external targets require approval. */
export function createWriteFileTool(workspace: Workspace): ToolDefinition<WriteFileInput, WriteFileOutput> {
  return {
    name: "write_file",
    description:
      "Write a UTF-8 text file. Overwriting an existing file, or writing outside the workspace, requires approval.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    parseInput: parseWriteInput,
    async assessRisk({ path }) {
      const target = workspace.resolve(path);
      if (!target.insideWorkspace) {
        return { kind: "external_file", reason: `Write outside the workspace: ${target.absolute}.`, target: target.absolute };
      }
      if (await exists(target.absolute)) {
        return {
          kind: "workspace_write",
          level: "medium",
          reason: `Overwrite existing file ${target.relative}.`,
          target: target.absolute,
        };
      }
      return { kind: "workspace_write", level: "low", reason: `Create file ${target.relative}.`, target: target.absolute };
    },
    async execute({ path, content }) {
      const target = workspace.resolve(path);
      await mkdir(dirname(target.absolute), { recursive: true });
      await writeFile(target.absolute, content, "utf8");
      return { path: target.insideWorkspace ? target.relative : target.absolute, bytes: Buffer.byteLength(content, "utf8") };
    },
  };
}

/** List a directory; external targets are classified as high risk. */
export function createListDirTool(workspace: Workspace): ToolDefinition<ListDirInput, ListDirOutput> {
  return {
    name: "list_dir",
    description: "List a directory. Targets outside the workspace require approval.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: false,
    },
    parseInput: parseListInput,
    assessRisk({ path }) {
      const target = workspace.resolve(path);
      return target.insideWorkspace
        ? { kind: "workspace_file", reason: `List workspace directory ${target.relative}.`, target: target.absolute }
        : { kind: "external_file", reason: `List directory outside the workspace: ${target.absolute}.`, target: target.absolute };
    },
    async execute({ path }) {
      const target = workspace.resolve(path);
      const dirents = await readdir(target.absolute, { withFileTypes: true });
      const entries = dirents
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? ("directory" as const) : entry.isFile() ? ("file" as const) : ("other" as const),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { path: target.insideWorkspace ? target.relative : target.absolute, entries };
    },
  };
}
