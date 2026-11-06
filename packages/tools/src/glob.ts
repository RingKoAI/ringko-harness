import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { pathRisk } from "./path-access.ts";
import { resolvePathTarget, type Workspace } from "./workspace.ts";

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
    async assessRisk({ path }) {
      return pathRisk(await resolvePathTarget(workspace, path ?? "."), "Glob");
    },
    async execute({ pattern, path }, context) {
      const source = path ?? ".";
      const target = await resolvePathTarget(workspace, source);
      if (!target.resolved) throw new TypeError(`Cannot resolve ${target.absolute} safely; retry the call.`);
      if (context?.approvedTarget && context.approvedTarget !== target.absolute) throw new Error("Glob target changed after approval; retry the call.");
      const matches: string[] = [];
      let truncated = false;
      for await (const match of new Bun.Glob(pattern).scan({ cwd: target.absolute, dot: false, followSymlinks: false })) {
        context?.signal?.throwIfAborted();
        const display = match.replace(/\\/g, "/");
        try {
          if ((await lstat(isAbsolute(match) ? match : join(target.absolute, match))).isSymbolicLink()) continue;
        } catch {
          continue;
        }
        if (matches.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        matches.push(display);
      }
      matches.sort();
      if ((await resolvePathTarget(workspace, source)).absolute !== target.absolute) throw new Error("Glob target changed while scanning; retry the call.");
      return {
        base: target.insideWorkspace ? target.relative || "." : target.absolute,
        matches,
        ...(truncated ? { truncated } : {}),
      };
    },
  });
}
