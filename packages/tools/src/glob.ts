import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import type { Workspace } from "./workspace.ts";

const MAX_RESULTS = 1000;

export interface GlobInput {
  pattern: string;
  path?: string;
}

export interface GlobOutput {
  base: string;
  matches: string[];
  truncated?: boolean;
}

function parseGlob(value: unknown): GlobInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.pattern !== "string" || record.pattern.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'pattern'.");
  }
  let base: string | undefined;
  if (record.path !== undefined) {
    if (typeof record.path !== "string" || record.path.trim().length === 0) {
      throw new TypeError("Expected a non-empty string 'path'.");
    }
    base = record.path;
  }
  return { pattern: record.pattern, ...(base !== undefined ? { path: base } : {}) };
}

/** Find files by glob pattern. Targets outside the workspace require approval. */
export function createGlobTool(workspace: Workspace): ToolDefinition<GlobInput, GlobOutput> {
  return defineTool<GlobInput, GlobOutput>({
    name: "glob",
    taskAccess: "read",
    description: "Find files matching a glob pattern (e.g. `**/*.ts`). Targets outside the workspace require approval.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, path: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
    parseInput: parseGlob,
    assessRisk({ path }) {
      const target = workspace.resolve(path ?? ".");
      return target.insideWorkspace
        ? { kind: "workspace_file", reason: `Glob ${target.relative}.`, target: target.absolute }
        : { kind: "external_file", reason: `Glob outside the workspace: ${target.absolute}.`, target: target.absolute };
    },
    async execute({ pattern, path }, context) {
      const target = workspace.resolve(path ?? ".");
      const matches: string[] = [];
      let truncated = false;
      for await (const match of new Bun.Glob(pattern).scan({ cwd: target.absolute, dot: false })) {
        context?.signal?.throwIfAborted();
        if (matches.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        matches.push(match.replace(/\\/g, "/"));
      }
      matches.sort();
      return {
        base: target.insideWorkspace ? target.relative || "." : target.absolute,
        matches,
        ...(truncated ? { truncated } : {}),
      };
    },
  });
}
