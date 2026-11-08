import { ToolRegistry, defineTool, type AccessMode, type ToolExecutionContext } from "@ringko-ai/harness";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { SubagentMode } from "./types.ts";

/** Tools a child may never call, regardless of mode: delegation and job control stay with the host. */
export const CHILD_EXCLUDED_TOOLS = new Set(["task", "task_control", "job", "subscribe"]);
const FILE_TOOLS = new Set(["read", "write", "edit", "glob", "grep", "tree"]);
const OPTIONAL_PATH_TOOLS = new Set(["glob", "grep", "tree"]);

function allows(mode: SubagentMode, access: string | undefined): boolean {
  if (mode === "full") return true;
  if (access === "read") return true;
  return mode === "write" && access === "write";
}

/**
 * Build the child capability view. Calls dispatch through the parent registry,
 * so approvals, sandbox policy, permission rules and event hooks stay in one
 * place; model arguments can never widen the requested mode.
 */
export function buildChildTools(parent: ToolRegistry, mode: SubagentMode, context: SubagentProviderExecutionContext): ToolRegistry {
  const tools = new ToolRegistry();
  for (const metadata of parent.list()) {
    if (CHILD_EXCLUDED_TOOLS.has(metadata.name) || !allows(mode, metadata.taskAccess)) continue;
    tools.register(defineTool({
      ...metadata,
      parseInput: (value: unknown) => value,
      assessRisk: () => ({ kind: "safe", reason: "Forward to the parent capability approval gate." }),
      execute: async (value: unknown, childContext) => {
        // Recheck membership at dispatch time: a registry mutation cannot grant
        // a capability the child was not admitted with.
        const current = parent.get(metadata.name)?.taskAccess;
        if (!allows(mode, current)) throw new Error("Subagent capability denied.");
        const approve = mode === "write"
          ? async (request: Parameters<NonNullable<ToolExecutionContext["requestApproval"]>>[0]) =>
              request.riskKind === "workspace_write" && !request.ruleRequired
                ? true
                : await context.requestApproval?.(request) === true
          : context.requestApproval;
        let input = value;
        if (context.cwd && FILE_TOOLS.has(metadata.name) && value && typeof value === "object" && !Array.isArray(value)) {
          const record = value as Record<string, unknown>;
          const path = record.path === undefined && OPTIONAL_PATH_TOOLS.has(metadata.name) ? "." : record.path;
          if (typeof path === "string" && path.trim()) input = { ...record, path: resolve(context.cwd, path) };
        }
        const output = await parent.call(metadata.name, input, approve, mode === "full" ? "full" : context.accessMode, {
          ...(childContext?.callId ? { callId: childContext.callId } : {}),
          signal: context.signal,
          ...(context.cwd ? { cwd: context.cwd } : {}),
          ...(context.jobs ? { jobs: context.jobs } : {}),
        });
        // Parent tools report workspace-relative paths. Absolute roots keep
        // those outputs reusable from a child whose cwd differs from the parent.
        if (context.workspace && FILE_TOOLS.has(metadata.name) && output && typeof output === "object" && !Array.isArray(output)) {
          const result = { ...output } as Record<string, unknown>;
          for (const key of ["path", "base"]) if (typeof result[key] === "string") result[key] = resolve(context.workspace, result[key]);
          if (metadata.name === "grep" && typeof result.base === "string") {
            // Grep's file-target names are workspace-relative; directory-target
            // names are base-relative. Make both reusable absolute paths.
            const directory = await stat(result.base).then(info => info.isDirectory(), () => false);
            const base = directory ? result.base : context.workspace;
            if (Array.isArray(result.files)) result.files = result.files.map(file => typeof file === "string" ? resolve(base, file) : file);
            for (const key of ["matches", "counts"]) if (Array.isArray(result[key])) result[key] = result[key].map(entry =>
              entry && typeof entry === "object" && typeof entry.file === "string" ? { ...entry, file: resolve(base, entry.file) } : entry);
          }
          return result;
        }
        return output;
      },
    }));
  }
  return tools;
}

export interface SubagentProviderExecutionContext {
  cwd?: string;
  workspace?: string;
  requestApproval?: (request: Parameters<NonNullable<ToolExecutionContext["requestApproval"]>>[0]) => Promise<boolean>;
  accessMode?: AccessMode;
  jobs?: ToolExecutionContext["jobs"];
  signal: AbortSignal;
}
