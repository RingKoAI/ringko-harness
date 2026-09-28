import type { SessionEvent } from "./types.ts";
export interface SessionJob { jobId: string; kind: "sub" | "shell"; description: string; status: "running" | "completed" | "failed" | "cancelled" | "unknown"; background: boolean; lastSeq: number; result?: unknown }
export function sessionJobs(events: readonly SessionEvent[], active = false): SessionJob[] {
  const jobs = new Map<string, SessionJob>();
  for (const event of events) {
    if (!event.type.startsWith("job/") || !event.data || typeof event.data !== "object") continue;
    const item = event.data as Record<string, unknown>;
    if (typeof item.jobId !== "string" || (item.kind !== "sub" && item.kind !== "shell")) continue;
    const data = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : {};
    if (item.type === "started") jobs.set(item.jobId, { jobId: item.jobId, kind: item.kind, description: typeof data.description === "string" ? data.description : item.kind, background: data.background === true, status: active ? "running" : "unknown", lastSeq: typeof item.seq === "number" ? item.seq : -1 });
    const job = jobs.get(item.jobId); if (!job) continue;
    if (typeof item.seq === "number") job.lastSeq = item.seq;
    if (item.type === "background") job.background = true;
    if (item.type === "completed" || item.type === "failed" || item.type === "cancelled") { job.status = item.type; job.result = data.result ?? (item.truncated ? data : undefined); }
  }
  return [...jobs.values()];
}
