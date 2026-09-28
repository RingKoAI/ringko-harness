import { readFile } from "node:fs/promises";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import type { Workspace } from "./workspace.ts";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1_000_000;

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
  head_limit?: number;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepOutput {
  base: string;
  matches: GrepMatch[];
  truncated?: boolean;
}

function parseGrep(value: unknown): GrepInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.pattern !== "string" || record.pattern.length === 0) {
    throw new TypeError("Expected a non-empty string 'pattern'.");
  }
  const input: GrepInput = { pattern: record.pattern };
  if (record.path !== undefined) {
    if (typeof record.path !== "string" || record.path.trim().length === 0) throw new TypeError("'path' must be a string.");
    input.path = record.path;
  }
  if (record.glob !== undefined) {
    if (typeof record.glob !== "string" || record.glob.trim().length === 0) throw new TypeError("'glob' must be a string.");
    input.glob = record.glob;
  }
  if (record.case_insensitive !== undefined) {
    if (typeof record.case_insensitive !== "boolean") throw new TypeError("'case_insensitive' must be a boolean.");
    input.case_insensitive = record.case_insensitive;
  }
  if (record.head_limit !== undefined) {
    if (typeof record.head_limit !== "number" || !Number.isInteger(record.head_limit) || record.head_limit < 1) {
      throw new TypeError("'head_limit' must be a positive integer.");
    }
    input.head_limit = record.head_limit;
  }
  return input;
}

/** Search file contents with a regular expression. External targets require approval. */
export function createGrepTool(workspace: Workspace): ToolDefinition<GrepInput, GrepOutput> {
  return defineTool<GrepInput, GrepOutput>({
    name: "grep",
    taskAccess: "read",
    description:
      "Search file contents with a JavaScript regular expression. Optionally restrict files with `glob`. External targets require approval.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        case_insensitive: { type: "boolean" },
        head_limit: { type: "integer", minimum: 1 },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    parseInput: parseGrep,
    assessRisk({ path }) {
      const target = workspace.resolve(path ?? ".");
      return target.insideWorkspace
        ? { kind: "workspace_file", reason: `Grep ${target.relative}.`, target: target.absolute }
        : { kind: "external_file", reason: `Grep outside the workspace: ${target.absolute}.`, target: target.absolute };
    },
    async execute({ pattern, path, glob, case_insensitive, head_limit }, context) {
      const target = workspace.resolve(path ?? ".");
      const limit = Math.min(head_limit ?? MAX_MATCHES, MAX_MATCHES);
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, case_insensitive ? "i" : "");
      } catch (error) {
        throw new Error(`Invalid regular expression: ${(error as Error).message}`);
      }

      const matches: GrepMatch[] = [];
      let truncated = false;
      for await (const file of new Bun.Glob(glob ?? "**/*").scan({ cwd: target.absolute, dot: false })) {
        context?.signal?.throwIfAborted();
        if (matches.length >= limit) {
          truncated = true;
          break;
        }
        const absolute = `${target.absolute}/${file}`;
        let text: string;
        try {
          const raw = await readFile(absolute, { encoding: "utf8", signal: context?.signal });
          if (raw.length > MAX_FILE_BYTES) continue;
          if (raw.includes("\u0000")) continue; // skip binary
          text = raw;
        } catch {
          context?.signal?.throwIfAborted();
          continue;
        }
        const lines = text.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          if (regex.test(lines[index])) {
            matches.push({ file: file.replace(/\\/g, "/"), line: index + 1, text: lines[index] });
            if (matches.length >= limit) {
              truncated = true;
              break;
            }
          }
        }
      }
      return {
        base: target.insideWorkspace ? target.relative || "." : target.absolute,
        matches,
        ...(truncated ? { truncated } : {}),
      };
    },
  });
}
