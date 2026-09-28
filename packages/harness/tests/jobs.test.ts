import { expect, it } from "bun:test";
import { JobManager, JOB_LIMITS } from "../src/jobs.ts";

it("supports detach, cursor subscription, cancellation and terminal notification", async () => {
  const jobs = new JobManager();
  let finish!: (value: string) => void;
  const job = jobs.start({ kind: "sub", description: "Inspect" }, async (_signal, emit) => {
    emit("sub/progress", { step: 1 });
    return await new Promise<string>(resolve => { finish = resolve; });
  });
  const foreground = jobs.foreground(job.jobId);
  jobs.detach(job.jobId);
  expect(await foreground).toMatchObject({ jobId: job.jobId, background: true, status: "running" });
  const page = await jobs.subscribe({ jobId: job.jobId, after: -1 });
  expect(page.events.map(event => event.type)).toEqual(["started", "sub/progress", "background"]);
  const waiting = jobs.subscribe({ jobId: job.jobId, after: page.job.lastSeq, waitMs: 1000 });
  finish("findings");
  expect((await waiting).job).toMatchObject({ status: "completed", result: "findings" });
  expect(await jobs.nextNotifications()).toMatchObject([{ jobId: job.jobId, result: "findings" }]);
  expect(await jobs.nextNotifications()).toEqual([]);
});

it("bounds event replay and removes cancelled long-poll listeners", async () => {
  const jobs = new JobManager();
  let finish!: () => void;
  const job = jobs.start({ kind: "shell", description: "Output", background: true }, async (_signal, emit) => {
    for (let index = 0; index < JOB_LIMITS.events + 4; index++) emit("stdout", "x".repeat(JOB_LIMITS.eventCharacters + 1));
    await new Promise<void>(resolve => { finish = resolve; });
    return "done";
  });
  const page = await jobs.subscribe({ jobId: job.jobId });
  expect(page.missed).toBe(true);
  expect(page.events.length).toBe(JOB_LIMITS.events);
  expect(page.events.every(event => event.truncated)).toBe(true);
  const controller = new AbortController();
  const pending = jobs.subscribe({ jobId: job.jobId, after: page.job.lastSeq, waitMs: 30000 }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
  finish(); await jobs.settle();
  expect(jobs.get(job.jobId).status).toBe("completed");
  expect(() => jobs.get("other-session-job")).toThrow("Unknown job");
});

it("does not launch work when the initial persisted event fails", () => {
  let ran = false;
  const jobs = new JobManager(() => { throw new Error("Disk full"); });
  expect(() => jobs.start({ kind: "sub", description: "Inspect" }, async () => { ran = true; })).toThrow("Disk full");
  expect(ran).toBe(false);
  expect(jobs.list()).toEqual([]);
});

it("isolates snapshots and callback payloads from internal job state", async () => {
  const jobs = new JobManager(event => { if (event.data && typeof event.data === "object") (event.data as { status?: string }).status = "cancelled"; });
  const job = jobs.start({ kind: "sub", description: "Inspect" }, async () => ({ content: "findings" }));
  await jobs.settle();
  const snapshot = jobs.get(job.jobId);
  (snapshot.result as { content: string }).content = "mutated";
  const foreground = await jobs.foreground(job.jobId) as { content: string };
  foreground.content = "mutated foreground";
  expect(jobs.get(job.jobId)).toMatchObject({ status: "completed", result: { content: "findings" } });
});
