import { ToolRegistry, defineTool, type AccessMode, type ToolExecutionContext } from "@ringko-ai/harness";
import type { SubagentMode } from "./types.ts";

/** Tools a child may never call, regardless of mode: delegation and job control stay with the host. */
export const CHILD_EXCLUDED_TOOLS = new Set(["task", "task_control", "job", "subscribe"]);

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
      execute: (value: unknown, childContext) => {
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
        return parent.call(metadata.name, value, approve, mode === "full" ? "full" : context.accessMode, {
          ...(childContext?.callId ? { callId: childContext.callId } : {}),
          signal: context.signal,
          ...(context.jobs ? { jobs: context.jobs } : {}),
        });
      },
    }));
  }
  return tools;
}

export interface SubagentProviderExecutionContext {
  requestApproval?: (request: Parameters<NonNullable<ToolExecutionContext["requestApproval"]>>[0]) => Promise<boolean>;
  accessMode?: AccessMode;
  jobs?: ToolExecutionContext["jobs"];
  signal: AbortSignal;
}
