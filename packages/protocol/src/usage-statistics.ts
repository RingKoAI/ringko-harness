import type { SessionUsage } from "./index.ts";

export type UsageCallKind = "primary" | "task" | "compaction" | "metadata" | "unknown";
export interface UsageStatisticsQuery {
  start?: number;
  end?: number;
  timeZone?: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  kind?: UsageCallKind;
  offset?: number;
  limit?: number;
}
export interface UsageRequest {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  time: number;
  provider: string | null;
  model: string | null;
  kind: UsageCallKind;
  durationMs: number | null;
  usage: SessionUsage;
}
export interface UsageStatisticsBucket {
  key: string;
  usage: SessionUsage | null;
  averageDurationMs: number | null;
  timedCalls: number;
}
export interface UsageStatistics {
  workspace: string;
  generatedAt: number;
  summary: SessionUsage | null;
  averageDurationMs: number | null;
  timedCalls: number;
  sessions: number;
  providers: UsageStatisticsBucket[];
  models: UsageStatisticsBucket[];
  trend: UsageStatisticsBucket[];
  grain: "day" | "month";
  requests: UsageRequest[];
  total: number;
  offset: number;
  limit: number;
  options: { providers: string[]; models: string[] };
  coverage: { scannedSessions: number; unreportedSessions: number; skippedSessions: number; deduplicatedCalls: number; limited: boolean };
}
