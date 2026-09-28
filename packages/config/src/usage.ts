// Aggregated token/cache usage at `~/.ringko/usage.json` (mode 0600).
//
// One record accumulates totals, a per-model breakdown, and a per-day breakdown.
// Cache read/write tokens come from the provider (AI SDK `inputTokenDetails`);
// the hit rate is `cacheRead / (input + cacheRead + cacheWrite)`.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { usagePath } from "./paths.ts";

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface UsageRecord {
  totals: UsageTotals;
  byModel: Record<string, UsageTotals>;
  byDay: Record<string, UsageTotals>;
}

export interface UsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function emptyTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseTotals(value: unknown): UsageTotals {
  if (!isRecord(value)) return emptyTotals();
  return {
    calls: num(value.calls),
    inputTokens: num(value.inputTokens),
    outputTokens: num(value.outputTokens),
    cacheReadTokens: num(value.cacheReadTokens),
    cacheWriteTokens: num(value.cacheWriteTokens),
  };
}

/** Read the usage record; a missing file yields zeroed totals. */
export function loadUsage(env: NodeJS.ProcessEnv = process.env): UsageRecord {
  let text: string;
  try {
    text = readFileSync(usagePath(env), "utf8");
  } catch {
    return { totals: emptyTotals(), byModel: {}, byDay: {} };
  }
  if (text.trim().length === 0) return { totals: emptyTotals(), byModel: {}, byDay: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { totals: emptyTotals(), byModel: {}, byDay: {} };
  }
  if (!isRecord(parsed)) return { totals: emptyTotals(), byModel: {}, byDay: {} };
  const byModel: Record<string, UsageTotals> = {};
  if (isRecord(parsed.byModel)) for (const [key, value] of Object.entries(parsed.byModel)) byModel[key] = parseTotals(value);
  const byDay: Record<string, UsageTotals> = {};
  if (isRecord(parsed.byDay)) for (const [key, value] of Object.entries(parsed.byDay)) byDay[key] = parseTotals(value);
  return { totals: parseTotals(parsed.totals), byModel, byDay };
}

function add(target: UsageTotals, delta: UsageDelta): void {
  target.calls += 1;
  target.inputTokens += delta.inputTokens ?? 0;
  target.outputTokens += delta.outputTokens ?? 0;
  target.cacheReadTokens += delta.cacheReadTokens ?? 0;
  target.cacheWriteTokens += delta.cacheWriteTokens ?? 0;
}

function save(record: UsageRecord, env: NodeJS.ProcessEnv): void {
  const path = usagePath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
}

/** Record one model call's usage under a model id and the current day. */
export function recordUsage(model: string, delta: UsageDelta, env: NodeJS.ProcessEnv = process.env): UsageRecord {
  const record = loadUsage(env);
  add(record.totals, delta);
  const modelKey = model.length > 0 ? model : "unknown";
  add((record.byModel[modelKey] ??= emptyTotals()), delta);
  const day = new Date().toISOString().slice(0, 10);
  add((record.byDay[day] ??= emptyTotals()), delta);
  save(record, env);
  return record;
}

/** Cache hit rate for a totals bucket: cache reads over all prompt tokens. */
export function cacheHitRate(totals: UsageTotals): number {
  const prompt = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return prompt > 0 ? totals.cacheReadTokens / prompt : 0;
}
