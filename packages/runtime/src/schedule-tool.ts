// Model-facing `schedule` tool: create/list/remove scheduled `time` events.
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { parseRule, type ScheduledTask, type Scheduler } from "./schedule.ts";

export interface ScheduleInput {
  action: "create" | "list" | "remove";
  at?: string | number;
  every?: number | string;
  daily?: string;
  weekly?: string;
  cron?: string;
  topic?: string;
  data?: unknown;
  id?: string;
}

export interface ScheduleOutput {
  tasks: ScheduledTask[];
  created?: ScheduledTask;
}

function parseSchedule(value: unknown): ScheduleInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Expected an object input.");
  const record = value as Record<string, unknown>;
  if (record.action !== "create" && record.action !== "list" && record.action !== "remove") {
    throw new TypeError("'action' must be create, list, or remove.");
  }
  if (record.action === "remove" && (typeof record.id !== "string" || record.id.trim().length === 0)) {
    throw new TypeError("'id' is required to remove a schedule.");
  }
  return record as unknown as ScheduleInput;
}

export function createScheduleTool(scheduler: Scheduler, options: { name?: string } = {}): ToolDefinition<ScheduleInput, ScheduleOutput> {
  const name = options.name ?? "schedule";
  return defineTool<ScheduleInput, ScheduleOutput>({
    name,
    concurrency: "exclusive",
    description:
      'Schedule events the agent is woken for. For create, give exactly one rule: at (ISO time or epoch ms), every ("10s"), daily ("09:00"), weekly ("mon 09:00"), or cron ("0 9 * * 1-5"). Use action=list to inspect and action=remove with id to delete. Due events arrive as "time" events; read them with subscribe.',
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "remove"] },
        at: { anyOf: [{ type: "string" }, { type: "number" }] },
        every: { anyOf: [{ type: "number" }, { type: "string" }] },
        daily: { type: "string" },
        weekly: { type: "string" },
        cron: { type: "string" },
        topic: { type: "string" },
        data: {},
        id: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    parseInput: parseSchedule,
    assessRisk() {
      return { kind: "safe", reason: "Manage scheduled events." };
    },
    execute(input) {
      if (input.action === "list") return { tasks: scheduler.list() };
      if (input.action === "remove") {
        scheduler.remove(input.id ?? "");
        return { tasks: scheduler.list() };
      }
      const rule = parseRule({ at: input.at, every: input.every, daily: input.daily, weekly: input.weekly, cron: input.cron });
      if (!rule) throw new TypeError("Provide exactly one schedule rule: at, every, daily, weekly, or cron.");
      const created = scheduler.create(rule, {
        ...(input.topic ? { topic: input.topic } : {}),
        ...(input.data !== undefined ? { data: input.data } : {}),
      });
      return { created, tasks: scheduler.list() };
    },
  });
}
