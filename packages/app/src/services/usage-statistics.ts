import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { backendKey, isPathInside } from "@ringko-ai/config";
import { parseLog, projectDirNames, SESSION_LOG_NAME, sessionTitle, sessionUsage, type SessionEvent, type SessionHeader } from "@ringko-ai/session";
import type { UsageCallKind, UsageRequest, UsageStatistics, UsageStatisticsBucket, UsageStatisticsQuery } from "@ringko-ai/protocol";

export const USAGE_STATISTICS_LIMITS = {
  sessions: 2048, fileBytes: 16 * 1024 * 1024, totalBytes: 128 * 1024 * 1024,
  calls: 100_000, pageSize: 25, maxPageSize: 100, filterCharacters: 1024,
  cacheMs: 2000, cacheEntries: 4, ancestry: 64, dailyBuckets: 90, identities: 512, trendBuckets: 1200,
} as const;
const DAY_MS = 86_400_000;
const KINDS: readonly UsageCallKind[] = ["primary", "task", "compaction", "metadata", "unknown"];
interface UsageSource { header: SessionHeader; title: string | null; events: SessionEvent[] }
interface LoadedUsage { sources: UsageSource[]; skipped: number; limited: boolean }
interface Call { event: SessionEvent; request: UsageRequest }

export function parseUsageStatisticsQuery(params: URLSearchParams): UsageStatisticsQuery {
  const result: UsageStatisticsQuery = {};
  for (const name of ["start", "end", "offset", "limit"] as const) {
    const raw = params.get(name);
    if (raw === null) continue;
    if (!/^\d{1,16}$/.test(raw)) throw new TypeError(`Invalid usage ${name}.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid usage ${name}.`);
    result[name] = value;
  }
  if ((result.limit !== undefined && (result.limit < 1 || result.limit > USAGE_STATISTICS_LIMITS.maxPageSize))
    || (result.start !== undefined && result.start > Date.now() + DAY_MS)
    || (result.end !== undefined && result.end > Date.now() + DAY_MS)
    || (result.start !== undefined && result.end !== undefined && result.start >= result.end)) throw new TypeError("Invalid usage range or page size.");
  for (const name of ["provider", "model", "sessionId", "timeZone"] as const) {
    const value = params.get(name);
    if (value === null) continue;
    if (!value || value.length > USAGE_STATISTICS_LIMITS.filterCharacters || /[\u0000-\u001f]/.test(value)) throw new TypeError(`Invalid usage ${name}.`);
    result[name] = value;
  }
  if (result.timeZone) new Intl.DateTimeFormat("en", { timeZone: result.timeZone });
  const kind = params.get("kind");
  if (kind !== null) {
    if (!KINDS.includes(kind as UsageCallKind)) throw new TypeError("Invalid usage call kind.");
    result.kind = kind as UsageCallKind;
  }
  return result;
}

/** Only read bounded regular logs beneath the selected workspace's session directory. */
async function loadUsage(root: string, workspace: string): Promise<LoadedUsage> {
  const loaded: LoadedUsage = { sources: [], skipped: 0, limited: false };
  let bytes = 0, sessions = 0, calls = 0;
  const identities = new Set<string>();
  const workspaceKey = backendKey(workspace);
  for (const projectName of projectDirNames(workspace)) {
    const project = join(root, projectName);
    let directory;
    try {
      if ((await lstat(project)).isSymbolicLink()) throw new Error("Linked session directory is unsupported.");
      if (!isPathInside(await realpath(root), await realpath(project))) throw new Error("Invalid session directory.");
      directory = await opendir(project);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const base = await realpath(project);
    for await (const entry of directory) {
      if (++sessions > USAGE_STATISTICS_LIMITS.sessions) { loaded.limited = true; break; }
      if (!entry.isDirectory() || entry.isSymbolicLink()) { loaded.skipped++; continue; }
      try {
        const path = join(project, entry.name, SESSION_LOG_NAME);
        if (!isPathInside(base, await realpath(path)) || (await lstat(path)).isSymbolicLink()) throw new Error("Linked session log is unsupported.");
        const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let text: string;
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > USAGE_STATISTICS_LIMITS.fileBytes) throw new Error("Session log exceeds the supported size.");
          if (bytes + info.size > USAGE_STATISTICS_LIMITS.totalBytes) { loaded.limited = true; break; }
          bytes += info.size;
          const buffer = Buffer.alloc(info.size);
          let read = 0;
          while (read < buffer.length) {
            const chunk = await file.read(buffer, read, buffer.length - read, read);
            if (!chunk.bytesRead) break;
            read += chunk.bytesRead;
          }
          text = buffer.subarray(0, read).toString("utf8");
        } finally { await file.close(); }
        const parsed = parseLog(text);
        if (!parsed.header.cwd || backendKey(parsed.header.cwd) !== workspaceKey) throw new Error("Session belongs to a different workspace.");
        const events = parsed.events.filter(event => event.type === "model/usage");
        for (const event of events) {
          const model = (event.data as { model?: unknown } | null)?.model;
          if (typeof model === "string") identities.add(model);
        }
        if (identities.size > USAGE_STATISTICS_LIMITS.identities) { loaded.limited = true; break; }
        if (calls + events.length > USAGE_STATISTICS_LIMITS.calls) { loaded.limited = true; break; }
        calls += events.length;
        loaded.sources.push({ header: parsed.header, title: sessionTitle(parsed.events)?.slice(0, 256) ?? null, events });
      } catch { loaded.skipped++; }
    }
    if (loaded.limited) break;
  }
  return loaded;
}

function signature(event: SessionEvent): string {
  return createHash("sha256").update(JSON.stringify([event.time, event.data])).digest("hex");
}
function duration(event: SessionEvent): number | null {
  const value = (event.data as { durationMs?: unknown })?.durationMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
function bucket(key: string, calls: readonly Call[]): UsageStatisticsBucket {
  const durations = calls.map(call => call.request.durationMs).filter((value): value is number => value !== null);
  // Incremental mean avoids overflowing the sum of durations.
  const mean = durations.reduce((mean, value, index) => mean + (value - mean) / (index + 1), 0);
  const events = calls.map(call => call.event).sort((a, b) => a.time - b.time || a.seq - b.seq);
  return { key, usage: sessionUsage(events), averageDurationMs: durations.length ? mean : null, timedCalls: durations.length };
}
function groups(calls: readonly Call[], key: (call: Call) => string): UsageStatisticsBucket[] {
  const entries = new Map<string, Call[]>();
  for (const call of calls) { const name = key(call); const list = entries.get(name) ?? []; list.push(call); entries.set(name, list); }
  return [...entries].map(([name, values]) => bucket(name, values)).sort((a, b) => (b.usage?.totalTokens ?? 0) - (a.usage?.totalTokens ?? 0) || a.key.localeCompare(b.key));
}

/** All views use the same deduplicated call set and cache-inclusive input semantics. */
export function usageStatistics(loaded: LoadedUsage, workspace: string, query: UsageStatisticsQuery, now = Date.now()): UsageStatistics {
  const sources = new Map(loaded.sources.map(source => [source.header.id, source]));
  const eventsBySource = new Map(loaded.sources.map(source => [source.header.id, new Map(source.events.map(event => [event.seq, event]))]));
  const signatures = new Map<SessionEvent, string>();
  const hash = (event: SessionEvent) => { let value = signatures.get(event); if (!value) { value = signature(event); signatures.set(event, value); } return value; };
  const unique = new Map<string, Call>();
  let deduplicatedCalls = 0, unreportedSessions = 0, ancestryLimited = false;
  for (const source of loaded.sources) {
    let reported = false;
    for (const event of source.events) {
      const usage = sessionUsage([event]);
      if (!usage || !Number.isSafeInteger(event.time) || event.time < 0 || event.time > now + DAY_MS) continue;
      reported = true;
      let owner = source;
      let ownerId = source.header.id;
      const visited = new Set([ownerId]);
      for (let depth = 0; depth < USAGE_STATISTICS_LIMITS.ancestry; depth++) {
        const parentId = owner.header.parentSession;
        if (!parentId) break;
        if (visited.has(parentId)) { ancestryLimited = true; break; }
        visited.add(parentId);
        const parent = sources.get(parentId);
        if (!parent) {
          if (event.time < owner.header.createdAt) ownerId = parentId;
          break;
        }
        const original = eventsBySource.get(parentId)?.get(event.seq);
        if (!original || hash(original) !== hash(event)) break;
        owner = parent; ownerId = parentId;
        if (depth === USAGE_STATISTICS_LIMITS.ancestry - 1 && owner.header.parentSession) ancestryLimited = true;
      }
      const id = `${ownerId}:${event.seq}:${hash(event)}`;
      if (unique.has(id)) { deduplicatedCalls++; continue; }
      const data = event.data as { model?: unknown; kind?: unknown };
      const model = typeof data.model === "string" && data.model.length > 0 && data.model.length <= USAGE_STATISTICS_LIMITS.filterCharacters
        && !/[\u0000-\u001f]/.test(data.model) ? data.model : null;
      const slash = model?.indexOf("/") ?? -1;
      unique.set(id, { event, request: {
        id, sessionId: owner.header.id, sessionTitle: owner.title, time: event.time,
        model, provider: model && slash > 0 ? model.slice(0, slash) : null,
        kind: KINDS.includes(data.kind as UsageCallKind) ? data.kind as UsageCallKind : "unknown",
        durationMs: duration(event), usage,
      } });
    }
    if (!reported) unreportedSessions++;
  }
  const start = query.start ?? 0, end = query.end ?? now + 1;
  const scoped = [...unique.values()].filter(({ request: call }) => call.time >= start && call.time < end
    && (!query.sessionId || call.sessionId === query.sessionId) && (!query.kind || call.kind === query.kind));
  const options = {
    providers: [...new Set(scoped.map(call => call.request.provider).filter((value): value is string => value !== null))].sort(),
    models: [...new Set(scoped.filter(call => !query.provider || call.request.provider === query.provider).map(call => call.request.model).filter((value): value is string => value !== null))].sort(),
  };
  const calls = scoped.filter(({ request: call }) => (!query.provider || call.provider === query.provider) && (!query.model || call.model === query.model))
    .sort((a, b) => b.request.time - a.request.time || a.request.id.localeCompare(b.request.id));
  const summary = bucket("total", calls);
  const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: query.timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  const dateKey = (time: number) => {
    const parts = dateFormat.formatToParts(time);
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
  };
  const first = query.start ?? calls.at(-1)?.request.time ?? now;
  const last = Math.max(first, end - 1);
  const grain = last - first > USAGE_STATISTICS_LIMITS.dailyBuckets * DAY_MS ? "month" : "day";
  const trendKey = (time: number) => dateKey(time).slice(0, grain === "day" ? 10 : 7);
  const trends = new Map(groups(calls, call => trendKey(call.request.time)).map(value => [value.key, value]));
  const trend: UsageStatisticsBucket[] = [];
  const cursor = new Date(`${dateKey(first).slice(0, grain === "day" ? 10 : 7)}${grain === "day" ? "" : "-01"}T00:00:00Z`);
  const lastKey = trendKey(last);
  // Query timestamps are bounded to the present; this also caps an all-time view from epoch.
  while (cursor.toISOString().slice(0, grain === "day" ? 10 : 7) <= lastKey && trend.length < USAGE_STATISTICS_LIMITS.trendBuckets) {
    const key = cursor.toISOString().slice(0, grain === "day" ? 10 : 7);
    trend.push(trends.get(key) ?? bucket(key, []));
    if (grain === "day") cursor.setUTCDate(cursor.getUTCDate() + 1); else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const offset = query.offset ?? 0, limit = query.limit ?? USAGE_STATISTICS_LIMITS.pageSize;
  return {
    workspace, generatedAt: now, summary: summary.usage, averageDurationMs: summary.averageDurationMs, timedCalls: summary.timedCalls,
    sessions: new Set(calls.map(call => call.request.sessionId)).size,
    providers: groups(calls, call => call.request.provider ?? ""), models: groups(calls, call => call.request.model ?? ""),
    trend, grain, requests: calls.slice(offset, offset + limit).map(call => call.request), total: calls.length, offset, limit, options,
    coverage: { scannedSessions: loaded.sources.length, unreportedSessions, skippedSessions: loaded.skipped, deduplicatedCalls, limited: loaded.limited || ancestryLimited },
  };
}

/** Short-lived bounded cache; concurrent dashboard reads share the same filesystem scan. */
export class UsageStatisticsService {
  private readonly cache = new Map<string, { until: number; value: Promise<LoadedUsage> }>();
  async read(root: string, workspace: string, query: UsageStatisticsQuery): Promise<UsageStatistics> {
    const key = JSON.stringify([root, workspace]);
    let cached = this.cache.get(key);
    if (!cached || cached.until <= Date.now()) {
      if (this.cache.size >= USAGE_STATISTICS_LIMITS.cacheEntries) this.cache.delete(this.cache.keys().next().value!);
      const value = loadUsage(root, workspace);
      cached = { until: Infinity, value };
      this.cache.set(key, cached);
      const entry = cached;
      void value.then(() => { entry.until = Date.now() + USAGE_STATISTICS_LIMITS.cacheMs; }, () => { if (this.cache.get(key)?.value === value) this.cache.delete(key); });
    }
    return usageStatistics(await cached.value, workspace, query);
  }
}
