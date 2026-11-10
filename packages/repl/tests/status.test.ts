import { expect, it } from "bun:test";
import stringWidth from "string-width";
import { statusEntries, statusLines, validateRuntimeStatus, statusSettings, validStatusSetting, usageStatusEntries, workspaceStatusEntries } from "../src/status.ts";
import type { SessionUsage, UsageStatistics } from "@ringko-ai/client";

it("reports real host/session identity without inventing a persisted session", () => {
  const report = { version: "1.2.3", entries: [{ label: "Model", value: "Fixture/model" }] };
  const empty = Object.fromEntries(statusEntries(report, {}).map(entry => [entry.label, entry.value]));
  expect(empty["Session ID"]).toBe("(not started)");
  expect(empty["Peer address"]).toBe("Embedded runtime");
  const connected = Object.fromEntries(statusEntries(report, { version: "1.2.4", id: "actual-id", title: "实际会话", peer: "http://user:peer-secret@127.0.0.1:8787/?token=secret#private" }).map(entry => [entry.label, entry.value]));
  expect(connected).toMatchObject({ Version: "1.2.4", "Backend version": "1.2.3", "Session ID": "actual-id", "Session name": "实际会话", "Peer address": "http://127.0.0.1:8787/" });
  expect(JSON.stringify(connected)).not.toContain("secret");
});

it("wraps paths and CJK by physical cells and removes terminal control injection", () => {
  const entries = [{ label: "Session name", value: "中文👩‍💻".repeat(20) + "\x1b]52;c;PRIVATE\x07\x1b[2J\nend" }, { label: "Setting sources", value: "C:\\a-very-long-path\\".repeat(20) }];
  for (const width of [1, 2, 12, 40, 71, 72, 100]) {
    const lines = statusLines(entries, width);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) { expect(stringWidth(line)).toBeLessThanOrEqual(width); expect(line).not.toContain("\x1b"); }
    expect(lines.join("\n")).not.toContain("PRIVATE");
  }
});

it("bounds malformed backend reports and pathological narrow-screen output", () => {
  for (const value of [null, {}, { version: null, entries: [null] }, { version: "x".repeat(65), entries: [] }, { version: null, entries: Array(33).fill({ label: "x", value: "y" }) }, { version: null, entries: [{ label: "x", value: "y".repeat(8193) }] }]) expect(() => validateRuntimeStatus(value)).toThrow("Invalid status");
  const valid = { version: null, entries: [{ label: "cwd", value: "fixture" }] };
  expect(validateRuntimeStatus(valid)).toBe(valid);
  const lines = statusLines(Array(32).fill({ label: "Field", value: "x".repeat(8192) }), 1);
  expect(lines.length).toBeLessThanOrEqual(1024);
});

it("exposes only valid, supported configuration edits and locks dependent settings", () => {
  const settings = statusSettings({ expandThinking: false, expandTools: true, thinking: "high", accessMode: "approval", updates: { checkOnStartup: false, autoUpdate: true } }, false);
  expect(settings).toHaveLength(6);
  expect(settings.find(setting => setting.key === "autoUpdate")?.disabledReason).toContain("startup");
  expect(settings.find(setting => setting.key === "thinking")?.disabledReason).toContain("embedded");
  expect(validStatusSetting("thinking", "max")).toBe(true);
  expect(validStatusSetting("thinking", true)).toBe(false);
  expect(validStatusSetting("accessMode", "unrestricted")).toBe(false);
  expect(validStatusSetting("__proto__" as never, "full")).toBe(false);
  expect(() => validateRuntimeStatus({ version: null, entries: [], settings: [{ key: "accessMode", label: "Access", value: "full", options: ["invalid"] }] })).toThrow("Invalid configuration");
});

it("keeps unreported usage unknown and does not double-count cached input tokens", () => {
  expect(usageStatusEntries(null)).toEqual([{ label: "Recorded usage", value: "Not reported yet" }]);
  const usage: SessionUsage = { calls: 2, inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 20, cacheWriteTokens: 10, cacheHitRate: 0.2, cacheReportedCalls: 2, partial: false, outputTokensPerSecond: 25 };
  const entries = Object.fromEntries(usageStatusEntries(usage).map(entry => [entry.label, entry.value]));
  expect(entries).toMatchObject({ "Input tokens": "100", "Total tokens": "150", "Cache hit rate": "20%", "Last primary output rate": "25 tokens/s" });
  const unknown = Object.fromEntries(usageStatusEntries({ ...usage, outputTokens: null, totalTokens: null, cacheHitRate: null }).map(entry => [entry.label, entry.value]));
  expect(unknown["Output tokens"]).toBe("Not reported"); expect(unknown["Total tokens"]).toBe("Not reported");
});

it("renders workspace statistics with reported timing and coverage", () => {
  const stats: UsageStatistics = { workspace: "fixture", generatedAt: Date.now(), summary: null, averageDurationMs: null, timedCalls: 0, sessions: 3, models: [], providers: [], trend: [], grain: "day", requests: [], total: 2, offset: 0, limit: 5, options: { providers: [], models: [] }, coverage: { scannedSessions: 3, skippedSessions: 1, unreportedSessions: 2, deduplicatedCalls: 0, limited: true } };
  const rows = Object.fromEntries(workspaceStatusEntries(stats, "7d").map(entry => [entry.label, entry.value]));
  expect(rows.Range).toBe("Last 7 days"); expect(rows["Mean request duration"]).toBe("Not reported"); expect(rows["Scan coverage"]).toContain("scan limit reached");
});
