import type { SessionEvent } from "./types.ts";

const USAGE_EVENT = "model/usage";
const FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
type UsageCounts = Partial<Record<(typeof FIELDS)[number], number>>;
interface UsageTarget { appendEvent(type: string, data?: unknown): SessionEvent }
export type ModelUsageKind = "primary" | "task" | "compaction" | "metadata";
const MILLISECONDS_PER_SECOND = 1000;

function counts(value: unknown): UsageCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: UsageCounts = {};
  for (const field of FIELDS) {
    const count = (value as Record<string, unknown>)[field];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[field] = count;
  }
  if (result.inputTokens !== undefined) {
    if ((result.cacheReadTokens ?? 0) > result.inputTokens) delete result.cacheReadTokens;
    if ((result.cacheWriteTokens ?? 0) > result.inputTokens) delete result.cacheWriteTokens;
  }
  return Object.keys(result).length ? result : undefined;
}

/** inputTokens is the provider's total input, including cache reads/writes. */
export function recordSessionUsage(target: UsageTarget, usage: unknown, model?: string, timing: { durationMs?: number; kind?: ModelUsageKind } = {}): SessionEvent | undefined {
  const valid = counts(usage);
  const durationMs = typeof timing.durationMs === "number" && Number.isFinite(timing.durationMs) && timing.durationMs > 0 ? timing.durationMs : undefined;
  return valid ? target.appendEvent(USAGE_EVENT, {
    model: model ?? null, usage: valid, inputIncludesCache: true,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(timing.kind && ["primary", "task", "compaction", "metadata"].includes(timing.kind) ? { kind: timing.kind } : {}),
  }) : undefined;
}

/** Project actual reported usage; missing fields and legacy sessions stay unknown. */
export function sessionUsage(events: readonly SessionEvent[]) {
  const buckets = Object.fromEntries(FIELDS.map(field => [field, { value: 0, seen: false, overflow: false }])) as Record<(typeof FIELDS)[number], { value: number; seen: boolean; overflow: boolean }>;
  let calls = 0;
  let partial = false;
  let cacheReportedCalls = 0;
  let cached = 0;
  let cacheInput = 0;
  let cacheOverflow = false;
  let primarySeen = false;
  let outputTokensPerSecond: number | null = null;
  for (const event of events) {
    if (event.type !== USAGE_EVENT || !event.data || typeof event.data !== "object") continue;
    const data = event.data as { usage?: unknown; inputIncludesCache?: unknown; durationMs?: unknown; kind?: unknown };
    if (data.inputIncludesCache !== true) continue;
    const usage = counts(data.usage);
    if (!usage) continue;
    calls++;
    if (data.kind === "primary") {
      primarySeen = true;
      const rate = usage.outputTokens !== undefined && typeof data.durationMs === "number" && Number.isFinite(data.durationMs) && data.durationMs > 0
        ? usage.outputTokens / data.durationMs * MILLISECONDS_PER_SECOND : NaN;
      outputTokensPerSecond = Number.isFinite(rate) && rate >= 0 ? rate : null;
    }
    if (usage.inputTokens === undefined || usage.outputTokens === undefined) partial = true;
    for (const field of FIELDS) {
      const value = usage[field];
      if (value === undefined) continue;
      const bucket = buckets[field];
      bucket.seen = true;
      if (!Number.isSafeInteger(bucket.value + value)) bucket.overflow = true;
      else bucket.value += value;
    }
    if (usage.inputTokens !== undefined && usage.cacheReadTokens !== undefined) {
      cacheReportedCalls++;
      if (!Number.isSafeInteger(cached + usage.cacheReadTokens) || !Number.isSafeInteger(cacheInput + usage.inputTokens)) cacheOverflow = true;
      else { cached += usage.cacheReadTokens; cacheInput += usage.inputTokens; }
    }
  }
  if (!calls) return null;
  const value = (field: (typeof FIELDS)[number]): number | null => buckets[field].seen && !buckets[field].overflow ? buckets[field].value : null;
  const inputTokens = value("inputTokens"), outputTokens = value("outputTokens");
  const totalTokens = inputTokens !== null && outputTokens !== null && Number.isSafeInteger(inputTokens + outputTokens) ? inputTokens + outputTokens : null;
  return {
    calls, inputTokens, outputTokens, totalTokens,
    cacheReadTokens: value("cacheReadTokens"), cacheWriteTokens: value("cacheWriteTokens"),
    cacheHitRate: !cacheOverflow && cacheInput > 0 ? cached / cacheInput : null,
    cacheReportedCalls,
    partial: partial || FIELDS.some(field => buckets[field].overflow) || cacheOverflow || totalTokens === null,
    ...(primarySeen ? { outputTokensPerSecond } : {}),
  };
}
