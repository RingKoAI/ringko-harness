import type { UsageStatistics } from "@ringko-ai/client";

export function statisticsFixture(): UsageStatistics {
  const usage = { calls: 4, inputTokens: 1000, outputTokens: 50, totalTokens: 1050, cacheReadTokens: 100, cacheWriteTokens: 0, cacheHitRate: 0.1, cacheReportedCalls: 4, partial: false };
  return {
    workspace: "fixture", generatedAt: Date.UTC(2026, 10, 10, 12), summary: usage, averageDurationMs: 2000, timedCalls: 4, sessions: 2,
    models: [{ key: "provider/model", usage, averageDurationMs: 2000, timedCalls: 4 }], providers: [], trend: [], grain: "day", requests: [], total: 4, offset: 0, limit: 5,
    options: { providers: [], models: [] }, coverage: { scannedSessions: 2, skippedSessions: 0, unreportedSessions: 0, deduplicatedCalls: 0, limited: false },
    activity: { today: "2026-11-10", timeZone: "UTC", days: [{ date: "2026-11-08", calls: 1 }, { date: "2026-11-09", calls: 3 }], activeDays: 2, totalDays: 3, longestStreak: 2, currentStreak: 2, mostActiveDay: { date: "2026-11-09", calls: 3 }, longestSessionMs: 86_400_000 },
  };
}
