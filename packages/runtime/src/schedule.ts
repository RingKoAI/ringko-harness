// Absolute / calendar scheduling: `at`, `every`, `daily`, `weekly`, `cron`.
//
// Pure recurrence arithmetic is separated from the timer that arms it: the
// scheduler appends a `time` event into the event log at each occurrence, so the
// model reads them through the same `subscribe` tool.
import type { EventLog } from "./log.ts";
import { parseDuration } from "./subscribe.ts";

export type ScheduleRule =
  | { kind: "at"; at: number }
  | { kind: "every"; everyMs: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "cron"; cron: string };

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_MS = 86_400_000;

/** Parse a `HH:MM` local time. */
function parseTime(value: string): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

/** Parse tool input into a schedule rule, or undefined when nothing is provided. */
export function parseRule(input: { at?: unknown; every?: unknown; daily?: unknown; weekly?: unknown; cron?: unknown }): ScheduleRule | undefined {
  if (input.at !== undefined) {
    const at = typeof input.at === "number" ? input.at : Date.parse(String(input.at));
    if (Number.isFinite(at)) return { kind: "at", at };
  }
  if (input.every !== undefined) {
    const everyMs = parseDuration(input.every);
    if (everyMs !== undefined) return { kind: "every", everyMs };
  }
  if (input.daily !== undefined) {
    const time = parseTime(String(input.daily));
    if (time) return { kind: "daily", ...time };
  }
  if (input.weekly !== undefined) {
    const match = /^(?:(\w{3})\s+)?(\d{1,2}:\d{2})$/.exec(String(input.weekly).trim());
    if (match) {
      const weekday = match[1] ? WEEKDAYS[match[1].toLowerCase()] : undefined;
      const time = parseTime(match[2]);
      if (time && weekday !== undefined) return { kind: "weekly", weekday, ...time };
    }
  }
  if (input.cron !== undefined && typeof input.cron === "string" && input.cron.trim().length > 0) {
    try {
      parseCron(input.cron);
      return { kind: "cron", cron: input.cron.trim() };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// --- cron (5-field: minute hour day-of-month month day-of-week) ---------------

interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

function parseCronField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error("Invalid cron step.");
    let start = min;
    let end = max;
    if (range !== "*") {
      const bounds = range.split("-");
      start = Number(bounds[0]);
      end = bounds.length > 1 ? Number(bounds[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
        throw new Error("Invalid cron range.");
      }
    } else {
      wildcard = true;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  if (values.size === 0) throw new Error("Empty cron field.");
  return { values, wildcard };
}

interface CronFields {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron must have 5 fields.");
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dom: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dow: parseCronField(parts[4], 0, 6),
  };
}

function cronMatches(fields: CronFields, date: Date): boolean {
  if (!fields.minute.values.has(date.getMinutes())) return false;
  if (!fields.hour.values.has(date.getHours())) return false;
  if (!fields.month.values.has(date.getMonth() + 1)) return false;
  const domMatch = fields.dom.values.has(date.getDate());
  const dowMatch = fields.dow.values.has(date.getDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (fields.dom.wildcard && fields.dow.wildcard) return true;
  if (fields.dom.wildcard) return dowMatch;
  if (fields.dow.wildcard) return domMatch;
  return domMatch || dowMatch;
}

function nextCron(expression: string, from: number): number | undefined {
  const fields = parseCron(expression);
  const date = new Date(from);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = from + 366 * DAY_MS;
  while (date.getTime() <= limit) {
    if (cronMatches(fields, date)) return date.getTime();
    date.setMinutes(date.getMinutes() + 1);
  }
  return undefined;
}

/** Next occurrence at or after `from`, or undefined when none. */
export function nextOccurrence(rule: ScheduleRule, from: number = Date.now()): number | undefined {
  switch (rule.kind) {
    case "at":
      return rule.at > from ? rule.at : undefined;
    case "every":
      return from + rule.everyMs;
    case "daily": {
      const date = new Date(from);
      date.setHours(rule.hour, rule.minute, 0, 0);
      if (date.getTime() <= from) date.setDate(date.getDate() + 1);
      return date.getTime();
    }
    case "weekly": {
      const date = new Date(from);
      date.setHours(rule.hour, rule.minute, 0, 0);
      let delta = (rule.weekday - date.getDay() + 7) % 7;
      if (delta === 0 && date.getTime() <= from) delta = 7;
      date.setDate(date.getDate() + delta);
      return date.getTime();
    }
    case "cron":
      return nextCron(rule.cron, from);
    default:
      return undefined;
  }
}

// --- Scheduler: arm rules and append `time` events --------------------------

export interface ScheduledTask {
  id: string;
  rule: ScheduleRule;
  topic: string;
  next: number | null;
  data?: unknown;
}

export class Scheduler {
  private readonly tasks = new Map<string, { task: ScheduledTask; timer?: ReturnType<typeof setTimeout> }>();
  private counter = 0;

  constructor(private readonly log: EventLog) {}

  create(rule: ScheduleRule, options: { topic?: string; data?: unknown } = {}): ScheduledTask {
    const id = `sched-${(this.counter += 1).toString(36)}`;
    const task: ScheduledTask = { id, rule, topic: options.topic ?? "time", next: null, ...(options.data !== undefined ? { data: options.data } : {}) };
    this.tasks.set(id, { task });
    this.arm(id);
    return task;
  }

  list(): ScheduledTask[] {
    return [...this.tasks.values()].map((entry) => ({ ...entry.task }));
  }

  remove(id: string): boolean {
    const entry = this.tasks.get(id);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.tasks.delete(id);
    return true;
  }

  private arm(id: string): void {
    const entry = this.tasks.get(id);
    if (!entry) return;
    const next = nextOccurrence(entry.task.rule, Date.now());
    if (next === undefined) {
      entry.task.next = null;
      return;
    }
    entry.task.next = next;
    const timer = setTimeout(() => {
      if (!this.tasks.has(id)) return;
      this.log.append(entry.task.topic, {
        scheduled: true,
        id,
        rule: entry.task.rule,
        at: new Date().toISOString(),
        ...(entry.task.data !== undefined ? { data: entry.task.data } : {}),
      });
      // One-shot `at` fires once; recurring rules re-arm.
      if (entry.task.rule.kind === "at") this.tasks.delete(id);
      else this.arm(id);
    }, Math.max(0, next - Date.now()));
    timer.unref?.();
    entry.timer = timer;
  }
}
