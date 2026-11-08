import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, legacyProjectDirName, serializeHeader, serializeEvent, recordUserMessage, type SessionEvent, type SessionHeader } from "@ringko-ai/session";
import type { UsageStatistics } from "@ringko-ai/protocol";
import { startServer } from "../src/server.ts";
import { parseUsageStatisticsQuery, usageStatistics, UsageStatisticsService, USAGE_STATISTICS_LIMITS } from "../src/services/usage-statistics.ts";

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY = 86_400_000;
function usage(seq: number, time: number, input: number, output: number, extra: Record<string, unknown> = {}): SessionEvent {
  return { type: "model/usage", seq, time, data: { model: "alpha/model", kind: "primary", inputIncludesCache: true, durationMs: 1000,
    usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 0 }, ...extra } };
}
function source(id: string, events: SessionEvent[], header: Partial<SessionHeader> = {}) {
  return { header: { id, version: 1, createdAt: NOW - 10 * DAY, ...header }, title: id, events };
}
const loaded = (...sources: ReturnType<typeof source>[]) => ({ sources, skipped: 0, limited: false });

it("includes legacy usage alongside new logs without mixing colliding workspaces", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-legacy-usage-"));
  const workspace = join(root, "a-b", "c"), foreign = join(root, "a", "b-c");
  try {
    const store = new SessionStore({ root: join(root, "sessions"), cwd: workspace });
    for (const [id, cwd] of [["legacy", workspace], ["foreign", foreign]]) {
      const dir = join(store.root, legacyProjectDirName(cwd), id!); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "session.jsonl"), serializeHeader({ id: id!, cwd, version: 1, createdAt: NOW }) + serializeEvent(usage(0, NOW, 10, 5)));
    }
    const fresh = store.create(); fresh.append([usage(0, NOW, 20, 5)]); fresh.close();
    const result = await new UsageStatisticsService().read(store.root, workspace, {});
    expect(result.summary?.inputTokens).toBe(30);
    expect(result.sessions).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("aggregates reported input once and computes weighted cache ratios across every view", () => {
  const records = loaded(source("a", [usage(0, NOW - DAY, 100, 20, { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0 } })]),
    source("b", [usage(0, NOW - 1000, 900, 30, { model: "beta/model", durationMs: 3000 })]));
  const data = usageStatistics(records, "workspace", { start: NOW - 2 * DAY, timeZone: "UTC", limit: 1 }, NOW);
  expect(data.summary).toMatchObject({ calls: 2, inputTokens: 1000, outputTokens: 50, totalTokens: 1050, cacheReadTokens: 100, cacheHitRate: 0.1 });
  expect(data.averageDurationMs).toBe(2000);
  expect(data.timedCalls).toBe(2);
  expect(data.sessions).toBe(2);
  expect(data.requests).toHaveLength(1);
  expect(data.providers.reduce((sum, item) => sum + item.usage!.totalTokens!, 0)).toBe(1050);
  expect(data.models.reduce((sum, item) => sum + item.usage!.calls, 0)).toBe(2);
  expect(data.trend.map(item => item.key)).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
  expect(data.trend[0].usage).toBeNull();
  expect(data.requests[0].model).toBe("beta/model");
  const filtered = usageStatistics(records, "workspace", { provider: "alpha", offset: 0 }, NOW);
  expect(filtered.summary?.calls).toBe(1);
  expect(filtered.options.providers).toEqual(["alpha", "beta"]);
  expect(filtered.options.models).toEqual(["alpha/model"]);
});

it("deduplicates inherited fork prefixes without merging independent identical calls", () => {
  const original = usage(0, NOW - DAY, 100, 10);
  const records = loaded(source("parent", [original]), source("fork", [{ ...original }, usage(1, NOW - 10, 20, 5)], { parentSession: "parent", createdAt: NOW - 1000 }),
    source("nested", [{ ...original }], { parentSession: "fork", createdAt: NOW - 500 }), source("independent", [{ ...original }]));
  const data = usageStatistics(records, "workspace", {}, NOW);
  expect(data.total).toBe(3);
  expect(data.summary?.inputTokens).toBe(220);
  expect(data.coverage.deduplicatedCalls).toBe(2);
  expect(usageStatistics(records, "workspace", { sessionId: "fork" }, NOW).summary?.inputTokens).toBe(20);
  expect(usageStatistics(records, "workspace", { sessionId: "nested" }, NOW).total).toBe(0);
});

it("deduplicates sibling inherited usage when their original session was deleted", () => {
  const original = usage(0, NOW - DAY, 100, 10);
  const data = usageStatistics(loaded(source("one", [original], { parentSession: "deleted", createdAt: NOW - 1000 }), source("two", [{ ...original }], { parentSession: "deleted", createdAt: NOW - 500 })), "workspace", {}, NOW);
  expect(data.total).toBe(1);
  expect(data.coverage.deduplicatedCalls).toBe(1);
});

it("keeps missing timing, cache data, usage and numeric overflow unknown", () => {
  const data = usageStatistics(loaded(source("partial", [usage(0, NOW - 100, 0, 0, { durationMs: null, usage: { inputTokens: Number.MAX_SAFE_INTEGER } }),
    usage(1, NOW - 10, 1, 0, { durationMs: -1, usage: { inputTokens: 1 } })]), source("legacy", [])), "workspace", {}, NOW);
  expect(data.summary).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: null, cacheHitRate: null, partial: true });
  expect(data.averageDurationMs).toBeNull();
  expect(data.coverage.unreportedSessions).toBe(1);
  expect(usageStatistics(loaded(), "workspace", {}, NOW).summary).toBeNull();
  const invalidIdentity = usageStatistics(loaded(source("unknown", [usage(0, NOW - 1, 1, 1, { model: "bad\u0000identity" })])), "workspace", {}, NOW);
  expect(invalidIdentity.requests[0].model).toBeNull();
  expect(invalidIdentity.options.models).toEqual([]);
});

it("filters call kinds, exact models and exclusive time boundaries using the selected timezone", () => {
  const midnight = Date.UTC(2026, 2, 8, 5); // Local midnight before the daylight-saving transition.
  const data = loaded(source("a", [usage(0, midnight - 1, 1, 1), usage(1, midnight, 2, 2), usage(2, midnight + 1, 3, 3, { kind: "task" })]));
  const result = usageStatistics(data, "workspace", { start: midnight, end: midnight + 2, kind: "task", model: "alpha/model", timeZone: "America/New_York" }, NOW);
  expect(result.total).toBe(1);
  expect(result.trend[0].key).toBe("2026-03-08");
  expect(result.summary?.totalTokens).toBe(6);
  expect(usageStatistics(data, "workspace", { start: midnight, end: midnight + 1 }, NOW).total).toBe(1);
  expect(usageStatistics(data, "workspace", { start: midnight - 200 * DAY }, NOW).grain).toBe("month");
});

it("rejects malformed dates, unbounded pages, timezone and call-type filters", () => {
  for (const query of ["limit=0", "limit=101", "offset=-1", "offset=1e6", "start=9999999999999999", "start=2&end=1", "timeZone=not-a-zone", "kind=arbitrary", "provider=%00", "model=" + "x".repeat(1025)]) {
    expect(() => parseUsageStatisticsQuery(new URLSearchParams(query))).toThrow();
  }
  expect(parseUsageStatisticsQuery(new URLSearchParams("provider=__proto__&model=all&limit=10"))).toMatchObject({ provider: "__proto__", model: "all", limit: 10 });
});

it("authenticates the endpoint, confines scans to the workspace and excludes transcript contents", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-usage-api-"));
  const before = process.env.RINGKO_HOME, agents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = root; process.env.AGENTS_HOME = join(root, "agents");
  let app: ReturnType<typeof startServer> | undefined;
  try {
    const workspace = join(root, "workspace"), other = join(root, "other");
    mkdirSync(workspace); mkdirSync(other);
    const store = new SessionStore({ cwd: workspace });
    const session = store.create();
    recordUserMessage(session, "private-transcript-content");
    session.append([usage(1, Date.now() - 1000, 100, 10)]); session.close();
    const foreign = new SessionStore({ cwd: other }).create();
    foreign.append([usage(0, Date.now() - 1000, 999, 999)]); foreign.close();
    app = startServer({ port: 0, workspace, shared: true, authToken: "usage-test-token" });
    const headers = { authorization: "Bearer usage-test-token" };
    expect((await fetch(`${app.url}/api/usage`)).status).toBe(401);
    expect((await fetch(`${app.url}/api/usage?limit=1000`, { headers })).status).toBe(400);
    expect((await fetch(`${app.url}/api/usage`, { headers: { ...headers, origin: "https://untrusted.example" } })).status).toBe(403);
    const response = await fetch(`${app.url}/api/usage?limit=1`, { headers });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("private-transcript-content");
    const data = JSON.parse(body) as UsageStatistics;
    expect(data.workspace).toBe(workspace);
    expect(data.total).toBe(1);
    expect(data.summary?.inputTokens).toBe(100);
    expect((await (await fetch(`${app.url}/api/usage?sessionId=${foreign.id}`, { headers })).json()).total).toBe(0);
  } finally {
    app?.stop();
    if (before === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = before;
    if (agents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = agents;
    rmSync(root, { recursive: true, force: true });
  }
});

it("reports incomplete coverage for oversized, corrupt and linked session logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-usage-files-"));
  try {
    const workspace = join(root, "workspace"); mkdirSync(workspace);
    const store = new SessionStore({ root: join(root, "sessions"), cwd: workspace });
    const valid = store.create(); valid.append([usage(0, Date.now() - 1000, 10, 2)]); valid.close();
    const meta = store.list()[0];
    const base = join(meta.dir, "..");
    const bad = join(base, "bad"), large = join(base, "large"), outside = join(root, "outside");
    for (const path of [bad, large, outside]) mkdirSync(path);
    writeFileSync(join(bad, "session.jsonl"), "not-json\n");
    writeFileSync(join(large, "session.jsonl"), "x".repeat(USAGE_STATISTICS_LIMITS.fileBytes + 1));
    writeFileSync(join(outside, "session.jsonl"), "private-outside-content\n");
    symlinkSync(outside, join(base, "linked"), process.platform === "win32" ? "junction" : "dir");
    const data = await new UsageStatisticsService().read(store.root, workspace, {});
    expect(data.total).toBe(1);
    expect(data.coverage.skippedSessions).toBe(3);
    expect(data.coverage.scannedSessions).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
