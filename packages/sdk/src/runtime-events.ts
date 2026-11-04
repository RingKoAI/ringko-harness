// Runtime event contract shared by the manager, contribution context and
// agent factory. Kept separate so factories can type the bus without importing
// the RuntimeManager implementation.

import type { Skill } from "@ringko-ai/config";
import type { AgentEvent, ToolExecutionEvent, ToolExecutionResult } from "@ringko-ai/harness";
import type { CapabilitySnapshot } from "./capabilities.ts";
import type { ModelExecutionEvent, ModelExecutionResult } from "./index.ts";

export interface RuntimeEvents extends Record<string, unknown> {
  "run/before": { prompt: string; signal: AbortSignal };
  "run/after": { content: string };
  "run/error": { error: unknown };
  "agent/event": AgentEvent;
  "tool/pre-execute": ToolExecutionEvent;
  "tool/post-execute": ToolExecutionResult;
  "model/before-request": ModelExecutionEvent;
  "model/after-response": ModelExecutionResult;
  "skill/installed": Skill;
  "capabilities/changed": CapabilitySnapshot;
  "tool/permission": { toolName: string; target?: string; decision: "allow" | "deny" | "ask" | "default" };
}
