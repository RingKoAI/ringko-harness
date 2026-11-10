import { expect, it } from "bun:test";
import stringWidth from "string-width";
import { activityHeatmap, compactCount, sessionSpan, statisticsLines, validateStatistics } from "../src/stats.ts";
import { statisticsFixture } from "./stats-fixture.ts";

it("renders a calendar overview with real totals, paired metrics and a separate model view", () => {
  const stats = statisticsFixture(); validateStatistics(stats);
  const overview = statisticsLines(stats, "all", "Overview", 99).map(line => line.text).join("\n");
  expect(overview).toContain("Mon "); expect(overview).toContain("Less ░ ▒ ▓ █ More"); expect(overview).toContain("Favorite model: provider/model");
  expect(overview).toContain("Total tokens: 1.1k"); expect(overview).toContain("Active days: 2/3"); expect(overview).toContain("Current streak: 2 days");
  expect(overview).toContain("Longest session: 1d 0h 0m"); expect(overview).toContain("idle time");
  expect(overview).toContain("Mean request duration: 2k ms"); expect(overview).toContain("Cache hit rate: 10%");
  const models = statisticsLines(stats, "7d", "Models", 99).map(line => line.text).join("\n");
  expect(models).toContain("Model usage"); expect(models).toContain("Calls: 4"); expect(models).toContain("Cache read: 100"); expect(models).not.toContain("Less ░");
});

it("keeps every physical row inside narrow widths and sanitizes model names", () => {
  const stats = statisticsFixture(); stats.models[0]!.key = "中文👩‍💻".repeat(30) + "\x1b]52;c;PRIVATE\x07\x1b[2J";
  for (const width of [1, 2, 12, 26, 39, 42, 68, 99]) {
    for (const view of ["Overview", "Models"] as const) for (const line of statisticsLines(stats, "30d", view, width)) {
      expect(stringWidth(line.text)).toBeLessThanOrEqual(width); expect(line.text).not.toContain("\x1b"); expect(line.text).not.toContain("PRIVATE");
    }
  }
  expect(activityHeatmap(statisticsFixture(), 26).some(line => line.text.includes("Recent 20 weeks"))).toBe(true);
});

it("does not invent activity for old backends or unreported token counts", () => {
  const stats = statisticsFixture(); delete stats.activity; stats.summary = null; stats.models = [];
  const text = statisticsLines(stats, "all", "Overview", 99).map(line => line.text).join("\n");
  expect(text).toContain("Activity detail unavailable"); expect(text).toContain("Total tokens: Not reported"); expect(text).toContain("Active days: Not reported");
  expect(statisticsLines(stats, "all", "Models", 99).some(line => line.text.includes("No model usage"))).toBe(true);
  for (const value of [null, undefined, -1, NaN, Infinity]) { expect(compactCount(value)).toBe("Not reported"); expect(sessionSpan(value)).toBe("Not reported"); }
  expect(compactCount(0)).toBe("0"); expect(sessionSpan(0)).toBe("<1m");
});

it("rejects oversized, malformed, duplicate and inconsistent activity payloads", () => {
  for (const mutate of [
    (stats: ReturnType<typeof statisticsFixture>) => { stats.models = Array(514).fill(stats.models[0]); },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.days[0]!.date = "2026-02-30"; },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.days.push(stats.activity!.days[0]!); },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.currentStreak = 3; },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.longestSessionMs = Infinity; },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.days[0]!.calls = -1; },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.days[0]!.date = "2026-11-11"; },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.days[0]!.date = "2025-11-09"; },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.activity!.mostActiveDay!.calls = 5; },
    (stats: ReturnType<typeof statisticsFixture>) => { stats.summary!.inputTokens = NaN; },
  ]) { const stats = statisticsFixture(); mutate(stats); expect(() => validateStatistics(stats)).toThrow(); }
});

it("keeps every supported model available through scrolling instead of limiting the view to five models", () => {
  const stats = statisticsFixture(), first = stats.models[0]!;
  stats.models = Array.from({ length: 513 }, (_, index) => ({ ...first, key: `provider/model-${index}` })); validateStatistics(stats);
  const rows = statisticsLines(stats, "all", "Models", 39);
  expect(rows.some(line => line.text === "provider/model-512")).toBe(true); expect(rows.length).toBeLessThanOrEqual(4096);
  expect(rows.some(line => line.text.includes("Output limit"))).toBe(false);
});
