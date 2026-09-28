// Workflows (modes) at `~/.ringko/workflows.json`, owned by the workflow package.
//
// A workflow is independent from the access permission: it shapes WHAT the agent
// does (guidance instructions, an optional model, an optional tool policy), while
// the permission decides how risky actions are gated. Workflows are defined as
// data; hosts ask this package to resolve and route them.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { workflowsPath } from "@ringko-ai/config";

export interface WorkflowTools {
  /** When non-empty, only these tool names are allowed. */
  allow?: string[];
  /** Always denied (wins over `allow`). */
  deny?: string[];
}

export interface WorkflowDef {
  label?: string;
  description?: string;
  /** Extra system instructions for this workflow. */
  instructions?: string;
  tools?: WorkflowTools;
  /** Optional model override (`<provider>/<modelId>`). */
  model?: string;
}

export interface Workflow extends WorkflowDef {
  id: string;
  builtin: boolean;
}

/** The applied result of routing a workflow: what a host should act on. */
export interface WorkflowRoute {
  id: string;
  /** Guidance appended to the system prompt (empty when none). */
  instructions: string;
  model?: string;
  tools?: WorkflowTools;
}

export const DEFAULT_WORKFLOW_ID = "agent";

export const BUILTIN_WORKFLOWS: Record<string, WorkflowDef> = {
  agent: {
    label: "Agent",
    description: "Default autonomous coding agent.",
  },
  plan: {
    label: "Plan",
    description: "Explore and design; present a plan for review before acting.",
    instructions:
      "You are in plan mode. Explore the codebase and design a complete plan before executing. Do not make changes yet; present the finished plan for the user to review. Every tool remains available, but prefer read-only exploration while planning.",
  },
  ask: {
    label: "Ask",
    description: "Answer questions using read-only exploration.",
    instructions: "Answer the question directly. Prefer read-only exploration; avoid making changes unless asked.",
  },
  debug: {
    label: "Debug",
    description: "Diagnose failures, fix minimally, verify with tests.",
    instructions: "Diagnose the failure, apply the smallest correct fix, then verify with the relevant tests.",
  },
};

export interface WorkflowFile {
  version?: number;
  workflows?: Record<string, WorkflowDef>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read `workflows.json` alone (missing/invalid yields `{}`). */
export function loadWorkflowFile(env: NodeJS.ProcessEnv = process.env): WorkflowFile {
  let text: string;
  try {
    text = readFileSync(workflowsPath(env), "utf8");
  } catch {
    return {};
  }
  if (text.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const workflows: Record<string, WorkflowDef> = {};
  if (isRecord(parsed.workflows)) {
    for (const [id, def] of Object.entries(parsed.workflows)) {
      if (isRecord(def)) workflows[id] = def as WorkflowDef;
    }
  }
  return { version: typeof parsed.version === "number" ? parsed.version : 1, workflows };
}

/** Write `workflows.json` (0600). */
export function saveWorkflowFile(file: WorkflowFile, env: NodeJS.ProcessEnv = process.env): string {
  const path = workflowsPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ version: file.version ?? 1, workflows: file.workflows ?? {} }, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
  return path;
}

/** Built-in workflows merged with user definitions (user wins per id). */
export function listWorkflows(env: NodeJS.ProcessEnv = process.env): Workflow[] {
  const file = loadWorkflowFile(env);
  const ids = new Set([...Object.keys(BUILTIN_WORKFLOWS), ...Object.keys(file.workflows ?? {})]);
  return [...ids].map((id) => ({
    id,
    builtin: Object.hasOwn(BUILTIN_WORKFLOWS, id),
    ...(BUILTIN_WORKFLOWS[id] ?? {}),
    ...(file.workflows?.[id] ?? {}),
  }));
}

/** Resolve one workflow by id (falls back to the default when unknown). */
export function resolveWorkflow(id: string | undefined, env: NodeJS.ProcessEnv = process.env): Workflow {
  const wanted = id && id.trim().length > 0 ? id : DEFAULT_WORKFLOW_ID;
  const workflows = listWorkflows(env);
  return workflows.find((workflow) => workflow.id === wanted) ?? workflows.find((workflow) => workflow.id === DEFAULT_WORKFLOW_ID) ?? {
    id: DEFAULT_WORKFLOW_ID,
    builtin: true,
    ...BUILTIN_WORKFLOWS[DEFAULT_WORKFLOW_ID],
  };
}

/** Whether a tool is permitted under a workflow (deny wins; empty allow = all). */
export function workflowAllowsTool(workflow: Workflow, toolName: string): boolean {
  const deny = workflow.tools?.deny ?? [];
  if (deny.includes(toolName)) return false;
  const allow = workflow.tools?.allow ?? [];
  return allow.length === 0 || allow.includes(toolName);
}

/** The workflow's extra instructions (trimmed), or an empty string. */
export function workflowInstructions(workflow: Workflow): string {
  return workflow.instructions?.trim() ?? "";
}

/** Route a workflow into the concrete actions a host applies. */
export function routeWorkflow(workflow: Workflow): WorkflowRoute {
  return {
    id: workflow.id,
    instructions: workflowInstructions(workflow),
    ...(workflow.model ? { model: workflow.model } : {}),
    ...(workflow.tools ? { tools: workflow.tools } : {}),
  };
}
