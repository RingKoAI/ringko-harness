import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import type { RuntimeStatus, SessionUsage, UsageStatistics } from "@ringko-ai/client";
import { statusEndpoint } from "@ringko-ai/config";
import { cleanTerminalText, fitTerminalLine } from "./editor.ts";
import { validateStatistics } from "./stats.ts";

const STATUS_LIMITS = Object.freeze({ entries: 32, identityEntries: 7, labelCharacters: 64, valueCharacters: 8192, fieldCharacters: 4096, lines: 1024 });
export interface StatusSession { id?: string; title?: string; version?: string; peer?: string }
export const STATUS_TABS = ["Status", "Config", "Usage", "Stats"] as const;
export type StatusTab = typeof STATUS_TABS[number];
export const STATS_PERIODS = ["all", "7d", "30d"] as const;
export type StatsPeriod = typeof STATS_PERIODS[number];
export type StatusSettingKey = "expandThinking" | "expandTools" | "checkOnStartup" | "autoUpdate" | "thinking" | "accessMode";
export interface StatusSetting { key: StatusSettingKey; label: string; value: boolean | string; options?: readonly string[]; disabledReason?: string }
export interface StatusPageReport extends RuntimeStatus { settings?: StatusSetting[]; statistics?: UsageStatistics }
export interface StatusConfigInfo {
  expandThinking: boolean; expandTools: boolean; thinking: string | null;
  accessMode: string; updates: { checkOnStartup: boolean; autoUpdate: boolean };
}
const BOOLEAN_SETTINGS = ["expandThinking", "expandTools", "checkOnStartup", "autoUpdate"] as const;
const ENUM_SETTINGS = { thinking: ["off", "low", "high", "max"], accessMode: ["approval", "assist", "full"] } as const;
export class StatusUnavailableError extends Error {}

export function statusSettings(info: StatusConfigInfo, configurableThinking = true): StatusSetting[] {
  if (typeof info.expandThinking !== "boolean" || typeof info.expandTools !== "boolean" || !info.updates || typeof info.updates.checkOnStartup !== "boolean" || typeof info.updates.autoUpdate !== "boolean" ||
      !(ENUM_SETTINGS.thinking as readonly string[]).includes(info.thinking ?? "high") || !(ENUM_SETTINGS.accessMode as readonly string[]).includes(info.accessMode)) throw new Error("Invalid configuration response.");
  return [
    { key: "expandThinking", label: "Show reasoning", value: info.expandThinking },
    { key: "expandTools", label: "Expand tool details", value: info.expandTools },
    { key: "checkOnStartup", label: "Check updates on startup", value: info.updates.checkOnStartup },
    { key: "autoUpdate", label: "Automatic updates", value: info.updates.autoUpdate, ...(!info.updates.checkOnStartup ? { disabledReason: "Enable startup update checks first." } : {}) },
    { key: "thinking", label: "Thinking effort", value: info.thinking ?? "high", options: ENUM_SETTINGS.thinking, ...(!configurableThinking ? { disabledReason: "This embedded host does not provide a configurable model client." } : {}) },
    { key: "accessMode", label: "Access mode", value: info.accessMode, options: ENUM_SETTINGS.accessMode },
  ];
}

export function validStatusSetting(key: StatusSettingKey, value: boolean | string): boolean {
  if ((BOOLEAN_SETTINGS as readonly string[]).includes(key)) return typeof value === "boolean";
  const options = key === "thinking" ? ENUM_SETTINGS.thinking : key === "accessMode" ? ENUM_SETTINGS.accessMode : undefined;
  return typeof value === "string" && options !== undefined && (options as readonly string[]).includes(value);
}

export function validateRuntimeStatus(value: unknown): StatusPageReport {
  if (!value || typeof value !== "object") throw new Error("Invalid status response.");
  const data = value as Partial<StatusPageReport>;
  if ((data.version !== null && typeof data.version !== "string") || (typeof data.version === "string" && data.version.length > STATUS_LIMITS.labelCharacters) ||
      !Array.isArray(data.entries) || data.entries.length > STATUS_LIMITS.entries || data.entries.some(entry => !entry || typeof entry.label !== "string" || entry.label.length > STATUS_LIMITS.labelCharacters || typeof entry.value !== "string" || entry.value.length > STATUS_LIMITS.valueCharacters)) throw new Error("Invalid status response.");
  if (data.settings !== undefined && (!Array.isArray(data.settings) || data.settings.length > 6 || data.settings.some(setting => !setting || typeof setting.label !== "string" || setting.label.length > STATUS_LIMITS.labelCharacters || !validStatusSetting(setting.key, setting.value) ||
      (setting.disabledReason !== undefined && (typeof setting.disabledReason !== "string" || setting.disabledReason.length > 512)) ||
      (typeof setting.value === "string" && (!Array.isArray(setting.options) || !setting.options.length || setting.options.length > 4 || setting.options.some(option => typeof option !== "string" || !validStatusSetting(setting.key, option))))))) throw new Error("Invalid configuration response.");
  if (data.statistics !== undefined) validateStatistics(data.statistics);
  return data as StatusPageReport;
}

const count = (value: number | null | undefined): string => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "Not reported";
export function usageStatusEntries(usage: SessionUsage | null | undefined): RuntimeStatus["entries"] {
  if (!usage) return [{ label: "Recorded usage", value: "Not reported yet" }];
  return [
    { label: "Reported model calls", value: count(usage.calls) }, { label: "Input tokens", value: count(usage.inputTokens) }, { label: "Output tokens", value: count(usage.outputTokens) }, { label: "Total tokens", value: count(usage.totalTokens) },
    { label: "Cache read tokens", value: count(usage.cacheReadTokens) }, { label: "Cache write tokens", value: count(usage.cacheWriteTokens) },
    { label: "Cache hit rate", value: typeof usage.cacheHitRate === "number" && Number.isFinite(usage.cacheHitRate) && usage.cacheHitRate >= 0 && usage.cacheHitRate <= 1 ? `${count(usage.cacheHitRate * 100)}%` : "Not reported" },
    { label: "Last primary output rate", value: usage.outputTokensPerSecond == null ? "Not reported" : `${count(usage.outputTokensPerSecond)} tokens/s` },
    { label: "Usage coverage", value: usage.partial ? "Partial provider-reported data" : "Provider-reported data" },
  ];
}

export function workspaceStatusEntries(stats: UsageStatistics, period: StatsPeriod): RuntimeStatus["entries"] {
  if (!stats || typeof stats.workspace !== "string" || !Array.isArray(stats.models) || !Array.isArray(stats.trend) || !stats.coverage) throw new Error("Invalid statistics response.");
  return [
    { label: "Workspace", value: stats.workspace }, { label: "Range", value: period === "all" ? "All recorded history" : period === "7d" ? "Last 7 days" : "Last 30 days" },
    { label: "Sessions in range", value: count(stats.sessions) }, { label: "Recorded requests", value: count(stats.total) }, ...usageStatusEntries(stats.summary),
    { label: "Mean request duration", value: stats.averageDurationMs === null ? "Not reported" : `${count(stats.averageDurationMs)} ms` },
    { label: "Requests with timing", value: count(stats.timedCalls) },
    ...stats.models.slice(0, 5).map(model => ({ label: `Model ${model.key}`.slice(0, STATUS_LIMITS.labelCharacters), value: `${count(model.usage?.totalTokens)} tokens · ${count(model.usage?.calls)} ${model.usage?.calls === 1 ? "call" : "calls"}` })),
    ...stats.trend.slice(-7).map(bucket => ({ label: bucket.key, value: `${count(bucket.usage?.totalTokens)} tokens` })),
    { label: "Scan coverage", value: `${count(stats.coverage.scannedSessions)} scanned; ${count(stats.coverage.skippedSessions)} skipped; ${count(stats.coverage.unreportedSessions)} without usage${stats.coverage.limited ? "; scan limit reached" : ""}` },
  ];
}

/** Do not invent a persisted session or provider-specific features for an empty REPL. */
export function statusEntries(report: RuntimeStatus, session: StatusSession): RuntimeStatus["entries"] {
  return [
    { label: "Version", value: session.version ?? report.version ?? "Not provided by host" },
    ...(session.version && report.version && report.version !== session.version ? [{ label: "Backend version", value: report.version }] : []),
    { label: "Session name", value: session.title ?? "(unnamed)" },
    { label: "Session ID", value: session.id ?? "(not started)" },
    { label: "Session kind", value: "interactive" },
    { label: "Peer address", value: !session.peer ? "Embedded runtime" : session.peer === "Connected backend" ? session.peer : statusEndpoint(session.peer) },
    ...report.entries,
  ];
}

/** Aligned columns on wide terminals, stacked fields on narrow ones; every row fits. */
export function statusLines(entries: RuntimeStatus["entries"], columns: number): string[] {
  const width = Math.max(1, Math.floor(columns));
  const labelWidth = Math.min(26, Math.floor(width / 3));
  const lines: string[] = [];
  const clean = (text: string) => cleanTerminalText(text.length > STATUS_LIMITS.fieldCharacters ? text.slice(0, STATUS_LIMITS.fieldCharacters - 1) + "…" : text).replace(/\s+/g, " ").trim();
  for (const entry of entries.slice(0, STATUS_LIMITS.entries + STATUS_LIMITS.identityEntries)) {
    const label = clean(entry.label) + ":";
    const prefix = width >= 72 ? fitTerminalLine(label, labelWidth - 1).padEnd(labelWidth) : "  ".slice(0, width - 1);
    const valueWidth = Math.max(1, width - stringWidth(prefix));
    if (width < 72) lines.push(...wrapAnsi(label, width, { hard: true, wordWrap: false, trim: false }).split("\n").map(line => fitTerminalLine(line, width)));
    const value = clean(entry.value) || "—";
    const chunks = wrapAnsi(value, valueWidth, { hard: true, wordWrap: true, trim: false }).split("\n");
    for (const [index, chunk] of chunks.entries()) {
      if (lines.length >= STATUS_LIMITS.lines) return [...lines.slice(0, STATUS_LIMITS.lines - 1), fitTerminalLine("[Status output truncated]", width)];
      lines.push((index === 0 ? prefix : " ".repeat(stringWidth(prefix))) + fitTerminalLine(chunk, valueWidth));
    }
  }
  return lines;
}
