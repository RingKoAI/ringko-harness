import type { AgentEvent, TaskEvent } from "@ringko-ai/sdk";
import type { SessionEvent } from "@ringko-ai/session";
import { applyAgentEvent, finishPendingTools, type ReplItem } from "./state.ts";

export interface SubagentView {
  id: string;
  description: string;
  mode: TaskEvent["mode"];
  model: string;
  parentCallId: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  reason?: string;
  items: ReplItem[];
}

const MAX_TASK_VIEWS = 32;
const MAX_TASK_ITEMS = 128;
const MAX_REPLAY_EVENTS = 16_384;
const MAX_EVENT_CHARACTERS = 8 * 1024;

function bounded(text: string): string {
  return text.length > MAX_EVENT_CHARACTERS ? `${text.slice(0, MAX_EVENT_CHARACTERS)}\n[Display truncated]` : text;
}

function displayEvent(event: AgentEvent): AgentEvent {
  return { ...event, message: {
    ...event.message,
    content: bounded(event.message.content),
    ...(typeof event.message.reasoning === "string" ? { reasoning: bounded(event.message.reasoning) } : {}),
    ...(Array.isArray(event.message.toolCalls) ? { toolCalls: event.message.toolCalls.slice(0, 64).filter(call => call && typeof call.id === "string" && typeof call.name === "string").map(call => ({ ...call,
      arguments: call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)
        ? Object.fromEntries(Object.entries(call.arguments).slice(0, 32).map(([key, value]) => [key, typeof value === "string" ? bounded(value) : value === null || typeof value === "number" || typeof value === "boolean" ? value : "[Nested input]" ]))
        : typeof call.arguments === "string" ? bounded(call.arguments) : call.arguments,
    })) } : {}),
  } };
}

/** Build one independent, bounded transcript per delegated task. */
export function applyTaskView(views: readonly SubagentView[], event: TaskEvent): SubagentView[] {
  if (!event || typeof event.taskId !== "string" || !event.taskId || event.taskId.length > 128 ||
    typeof event.description !== "string" || event.description.length > 120 ||
    typeof event.model !== "string" || event.model.length > 256 ||
    !["read", "write", "full"].includes(event.mode) ||
    !["started", "event", "completed", "failed", "cancelled"].includes(event.type)) return [...views];
  if (event.type === "event" && (!event.event || !event.event.message || typeof event.event.message.content !== "string" ||
    !["tool_call", "tool", "tool_error", "model"].includes(event.event.type))) return [...views];
  const index = views.findIndex(view => view.id === event.taskId);
  const previous: SubagentView = index < 0 ? {
    id: event.taskId, description: event.description, mode: event.mode, model: event.model,
    parentCallId: event.parentCallId, status: "running", items: [],
  } : views[index]!;
  const next: SubagentView = event.type === "event"
    ? event.event ? { ...previous, items: applyAgentEvent(previous.items, displayEvent(event.event)).slice(-MAX_TASK_ITEMS) } : previous
    : event.type === "started" ? previous
      : { ...previous, status: event.type, ...(event.reason ? { reason: event.reason } : {}), items: finishPendingTools(previous.items) };
  const result = index < 0 ? [...views, next] : views.map((view, position) => position === index ? next : view);
  return result.length > MAX_TASK_VIEWS ? result.slice(-MAX_TASK_VIEWS) : result;
}

export function restoreTaskViews(events: readonly SessionEvent[]): SubagentView[] {
  return events.slice(-MAX_REPLAY_EVENTS).reduce<SubagentView[]>((views, entry) => {
    if (!entry.type.startsWith("task/") || !entry.data || typeof entry.data !== "object") return views;
    return applyTaskView(views, entry.data as TaskEvent);
  }, []);
}
