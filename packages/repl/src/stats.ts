import stringWidth from "string-width";
import type { SessionUsage, UsageStatistics } from "@ringko-ai/client";
import { cleanTerminalText, fitTerminalLine } from "./editor.ts";
import type { StatsPeriod } from "./status.ts";

export const STATS_VIEWS = ["Overview", "Models"] as const;
export type StatsView = typeof STATS_VIEWS[number];
export interface StatsLine { text: string; tone?: "muted" | "chart"; bold?: boolean; parts?: Array<{ text: string; selected?: boolean; tone?: "chart" }> }
// The backend supports 512 identities plus the bucket for unreported model identity.
const LIMITS = { models: 513, trend: 1200, days: 366, weeks: 53, lines: 4096, name: 1024, dateMs: 8_640_000_000_000_000 } as const;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const HEAT = ["·", "░", "▒", "▓", "█"] as const;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
const dateIndex = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const validDate = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(dateIndex(date)) && new Date(dateIndex(date) * DAY_MS).toISOString().slice(0, 10) === date;

/** Validate the bounded statistics payload before rendering data from a backend. */
export function validateStatistics(value: UsageStatistics): void {
  const validUsage = (usage: SessionUsage | null): boolean => usage === null || Boolean(usage && integer(usage.calls) &&
    [usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.cacheReadTokens, usage.cacheWriteTokens].every(count => count === null || integer(count)) &&
    (usage.cacheHitRate === null || finite(usage.cacheHitRate) && usage.cacheHitRate <= 1) && typeof usage.partial === "boolean");
  if (!value || typeof value.workspace !== "string" || value.workspace.length > LIMITS.name || !integer(value.generatedAt) || value.generatedAt > LIMITS.dateMs ||
      !integer(value.sessions) || !integer(value.total) || !validUsage(value.summary) ||
      !Array.isArray(value.models) || value.models.length > LIMITS.models || value.models.some(model => !model || typeof model.key !== "string" || model.key.length > LIMITS.name || !validUsage(model.usage)) ||
      !Array.isArray(value.trend) || value.trend.length > LIMITS.trend || !value.coverage ||
      ![value.coverage.scannedSessions, value.coverage.skippedSessions, value.coverage.unreportedSessions].every(integer) || typeof value.coverage.limited !== "boolean") throw new Error("Invalid statistics response.");
  const activity = value.activity;
  if (activity !== undefined && (!activity || !validDate(activity.today) || typeof activity.timeZone !== "string" || activity.timeZone.length > LIMITS.name ||
      !Array.isArray(activity.days) || activity.days.length > LIMITS.days || activity.days.some(day => !day || !validDate(day.date) || !integer(day.calls) || day.calls === 0 || day.date > activity.today || dateIndex(activity.today) - dateIndex(day.date) >= LIMITS.days) ||
      new Set(activity.days.map(day => day.date)).size !== activity.days.length ||
      ![activity.activeDays, activity.totalDays, activity.longestStreak, activity.currentStreak].every(integer) || activity.days.length > activity.activeDays || activity.activeDays > activity.totalDays || activity.longestStreak > activity.activeDays || activity.currentStreak > activity.longestStreak ||
      !(activity.longestSessionMs === null || finite(activity.longestSessionMs)) ||
      !(activity.mostActiveDay === null || activity.mostActiveDay && validDate(activity.mostActiveDay.date) && activity.mostActiveDay.date <= activity.today && integer(activity.mostActiveDay.calls) && activity.mostActiveDay.calls > 0 && activity.mostActiveDay.calls <= value.total))) throw new Error("Invalid activity response.");
}

export function compactCount(value: number | null | undefined): string {
  return finite(value) ? new Intl.NumberFormat("en-US", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value).toLowerCase() : "Not reported";
}
export function sessionSpan(value: number | null | undefined): string {
  if (!finite(value)) return "Not reported";
  if (value < MINUTE_MS) return "<1m";
  const days = Math.floor(value / DAY_MS), hours = Math.floor(value % DAY_MS / HOUR_MS), minutes = Math.floor(value % HOUR_MS / MINUTE_MS);
  return [days ? `${days}d` : "", hours || days ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
}
const safe = (text: string) => cleanTerminalText(text.slice(0, LIMITS.name)).replace(/\s+/g, " ").trim();
const shortDate = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

/** A Sunday-first calendar, capped to a year and cropped to recent weeks on narrow screens. */
export function activityHeatmap(stats: UsageStatistics, width: number): StatsLine[] {
  if (!stats.activity) return [{ text: fitTerminalLine("Activity detail unavailable; restart the backend.", width), tone: "muted" }];
  if (width < 12) return [{ text: fitTerminalLine("Activity", width), tone: "muted" }];
  const today = dateIndex(stats.activity.today), weeks = Math.max(1, Math.min(LIMITS.weeks, width - 6));
  const lastSunday = today - new Date(today * DAY_MS).getUTCDay(), first = lastSunday - (weeks - 1) * 7;
  const counts = new Map(stats.activity.days.map(day => [dateIndex(day.date), day.calls]));
  const peak = Math.max(1, ...counts.values());
  const months = Array<string>(weeks + 2).fill(" "); let previousMonth = -1, lastLabel = -3;
  for (let week = 0; week < weeks; week++) {
    const month = new Date((first + week * 7) * DAY_MS).getUTCMonth();
    if (month !== previousMonth && week >= lastLabel + 3) {
      for (const [offset, char] of Array.from(MONTHS[month]).entries()) months[week + offset] = char;
      lastLabel = week;
    }
    previousMonth = month;
  }
  const lines: StatsLine[] = [{ text: `    ${months.join("")}`, tone: "muted" }];
  for (let weekday = 0; weekday < 7; weekday++) {
    const label = weekday === 1 ? "Mon " : weekday === 3 ? "Wed " : weekday === 5 ? "Fri " : "    ";
    let cells = "";
    for (let week = 0; week < weeks; week++) {
      const day = first + week * 7 + weekday, calls = counts.get(day) ?? 0;
      cells += day > today || day <= today - LIMITS.days ? " " : HEAT[calls ? Math.max(1, Math.ceil(calls / peak * (HEAT.length - 1))) : 0];
    }
    lines.push({ text: label + cells, parts: [{ text: label }, ...Array.from(cells, text => ({ text, ...(text !== "·" && text !== " " ? { tone: "chart" as const } : {}) }))] });
  }
  lines.push({ text: "    " + fitTerminalLine("Less ░ ▒ ▓ █ More", width - 4), tone: "muted" });
  if (weeks < LIMITS.weeks) lines.push({ text: fitTerminalLine(`Recent ${weeks} weeks · calls/day`, width), tone: "muted" });
  return lines;
}

/** Physical rows keep the overview compact and preserve all model details through scrolling. */
export function statisticsLines(stats: UsageStatistics, period: StatsPeriod, view: StatsView, columns: number): StatsLine[] {
  const width = Math.max(1, Math.floor(columns)), lines: StatsLine[] = [];
  const row = (text = "", tone?: StatsLine["tone"], bold = false) => { lines.push({ text: fitTerminalLine(safe(text), width), tone, bold }); };
  const pair = (left: string, right: string, tone?: StatsLine["tone"]) => {
    if (width < 68) { row(left, tone); row(right, tone); return; }
    const leftWidth = Math.floor((width - 4) / 2), leftText = fitTerminalLine(safe(left), leftWidth);
    lines.push({ text: leftText + " ".repeat(leftWidth - stringWidth(leftText) + 4) + fitTerminalLine(safe(right), width - leftWidth - 4), tone });
  };
  const choices = width >= 37 ? ["All time", "Last 7 days", "Last 30 days"] : width >= 27 ? ["All time", "7 days", "30 days"] : ["All", "7d", "30d"];
  const parts = choices.flatMap((text, index) => [...(index ? [{ text: " · " }] : []), { text, selected: index === ["all", "7d", "30d"].indexOf(period) }]);
  const range: StatsLine = { text: parts.map(part => part.text).join(""), parts };
  if (stringWidth(range.text) > width) { range.text = fitTerminalLine(choices[["all", "7d", "30d"].indexOf(period)], width); delete range.parts; }
  if (view === "Overview") {
    lines.push(...activityHeatmap(stats, width)); row(); lines.push(range); row();
    const favorite = stats.models.reduce<typeof stats.models[number] | undefined>((best, model) => !best || (model.usage?.calls ?? 0) > (best.usage?.calls ?? 0) ? model : best, undefined);
    const activity = stats.activity;
    const streak = (value: number | undefined) => value === undefined ? "Not reported" : `${value} ${value === 1 ? "day" : "days"}`;
    pair(`Favorite model: ${favorite?.key || "Not reported"}`, `Total tokens: ${compactCount(stats.summary?.totalTokens)}`); row();
    pair(`Sessions: ${compactCount(stats.sessions)}`, `Longest session: ${sessionSpan(activity?.longestSessionMs)}`);
    pair(`Active days: ${activity ? `${activity.activeDays}/${activity.totalDays}` : "Not reported"}`, `Longest streak: ${streak(activity?.longestStreak)}`);
    pair(`Most active day: ${activity?.mostActiveDay ? shortDate(activity.mostActiveDay.date) : "Not reported"}`, `Current streak: ${streak(activity?.currentStreak)}`);
    const usage = stats.summary;
    const tokens = [`Input ${compactCount(usage?.inputTokens)}`, `Output ${compactCount(usage?.outputTokens)}`, `Cache read ${compactCount(usage?.cacheReadTokens)}`, `Cache write ${compactCount(usage?.cacheWriteTokens)}`];
    if (stringWidth(tokens.join(" · ")) <= width) row(tokens.join(" · ")); else { pair(tokens[0], tokens[1]); pair(tokens[2], tokens[3]); }
    row(); pair(`Recorded requests: ${compactCount(stats.total)}`, `Requests with timing: ${compactCount(stats.timedCalls)}`, "muted");
    pair(`Mean request duration: ${finite(stats.averageDurationMs) ? `${compactCount(stats.averageDurationMs)} ms` : "Not reported"}`, `Last primary output rate: ${finite(usage?.outputTokensPerSecond) ? `${compactCount(usage.outputTokensPerSecond)} tokens/s` : "Not reported"}`, "muted");
    row(`Cache hit rate: ${finite(usage?.cacheHitRate) ? `${compactCount(usage.cacheHitRate * 100)}%` : "Not reported"}`, "muted");
    row(`Recorded activity · ${activity?.timeZone ?? "timezone not reported"} · session spans include idle time`, "muted");
  } else {
    lines.push(range); row(); row("Model usage", undefined, true); row();
    if (!stats.models.length) row("No model usage recorded for this period.", "muted");
    for (const model of stats.models) {
      row(model.key || "Unknown model", undefined, true);
      pair(`Calls: ${compactCount(model.usage?.calls)} · Tokens: ${compactCount(model.usage?.totalTokens)}`, `Input: ${compactCount(model.usage?.inputTokens)} · Output: ${compactCount(model.usage?.outputTokens)}`);
      pair(`Cache read: ${compactCount(model.usage?.cacheReadTokens)}`, `Cache write: ${compactCount(model.usage?.cacheWriteTokens)}`); row();
    }
  }
  if (stats.summary?.partial) row("Partial provider-reported token data.", "muted");
  row(`Scan coverage: ${stats.coverage.scannedSessions} scanned; ${stats.coverage.skippedSessions} skipped${stats.coverage.limited ? "; scan limit reached" : ""}`, "muted");
  return lines.length > LIMITS.lines ? [...lines.slice(0, LIMITS.lines - 1), { text: fitTerminalLine("Output limit reached; narrow the date range.", width), tone: "muted" }] : lines;
}
