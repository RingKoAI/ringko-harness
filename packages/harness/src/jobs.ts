import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "./tools.ts";
import { abortable } from "./cancellation.ts";

export const JOB_LIMITS = Object.freeze({ active: 4, perRun: 32, events: 200, eventCharacters: 8192, resultCharacters: 163840, waitMs: 30_000 });
export type JobStatus = "running" | "completed" | "failed" | "cancelled";
export interface JobEvent { seq: number; jobId: string; kind: "sub" | "shell"; type: string; time: number; data: unknown; truncated: boolean }
export interface JobSnapshot { jobId: string; kind: "sub" | "shell"; description: string; status: JobStatus; background: boolean; result?: unknown; error?: string; lastSeq: number }
interface Job {
  snapshot: JobSnapshot; controller: AbortController; events: JobEvent[]; nextSeq: number;
  listeners: Set<() => void>; done: Promise<void>; resolveDone: () => void;
}
export interface JobOptions { kind: "sub" | "shell"; description: string; background?: boolean; signal?: AbortSignal }
export interface JobInput { jobId: string; action?: "status" | "cancel" | "background"; after?: number; waitMs?: number }

function bounded(value: unknown, limit: number): { data: unknown; truncated: boolean } {
  const text = JSON.stringify(value ?? null);
  return text.length <= limit ? { data: JSON.parse(text), truncated: false } : { data: { preview: text.slice(0, limit), truncated: true }, truncated: true };
}
function parse(value: unknown): JobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a job request.");
  const data = value as Record<string, unknown>;
  if (typeof data.jobId !== "string" || data.jobId.length > 128 || !data.jobId) throw new TypeError("A jobId is required.");
  if (data.action !== undefined && !["status", "cancel", "background"].includes(String(data.action))) throw new TypeError("Invalid job action.");
  for (const field of ["after", "waitMs"] as const) if (data[field] !== undefined && (!Number.isSafeInteger(data[field]) || (data[field] as number) < (field === "after" ? -1 : 0) || (field === "waitMs" && (data[field] as number) > JOB_LIMITS.waitMs))) throw new TypeError(`Invalid ${field}.`);
  return { jobId: data.jobId, action: data.action as JobInput["action"], after: data.after as number | undefined, waitMs: data.waitMs as number | undefined };
}

/** Session-local jobs. Reservations and transitions are synchronous; bounded replay uses sequence cursors. */
export class JobManager {
  private jobs = new Map<string, Job>();
  private notifications: JobSnapshot[] = [];
  constructor(private readonly onEvent?: (event: JobEvent) => void) {}
  start(options: JobOptions, work: (signal: AbortSignal, emit: (type: string, data: unknown) => void, jobId: string) => Promise<unknown>): JobSnapshot {
    if (!options || !["sub", "shell"].includes(options.kind) || typeof options.description !== "string" || options.description.length > 256 || typeof work !== "function" || (options.background !== undefined && typeof options.background !== "boolean")) throw new TypeError("Invalid job options.");
    options.signal?.throwIfAborted();
    if (this.jobs.size >= JOB_LIMITS.perRun || this.list().filter(job => job.status === "running").length >= JOB_LIMITS.active) throw new Error("Background job limit reached.");
    const jobId = randomUUID();
    let resolveDone!: () => void;
    const job: Job = { snapshot: { jobId, kind: options.kind, description: options.description, status: "running", background: options.background === true, lastSeq: -1 }, controller: new AbortController(), events: [], nextSeq: 0, listeners: new Set(), done: new Promise(resolve => { resolveDone = resolve; }), resolveDone: () => resolveDone() };
    this.jobs.set(jobId, job);
    const cancel = () => job.controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", cancel, { once: true });
    const emit = (type: string, data: unknown) => {
      const event: JobEvent = { seq: job.nextSeq++, jobId, kind: options.kind, type, time: Date.now(), ...bounded(data, JOB_LIMITS.eventCharacters) };
      job.events.push(event); if (job.events.length > JOB_LIMITS.events) job.events.shift();
      job.snapshot.lastSeq = event.seq;
      this.onEvent?.(structuredClone(event));
      for (const listener of [...job.listeners]) listener();
    };
    try { emit("started", job.snapshot); }
    catch (error) { this.jobs.delete(jobId); options.signal?.removeEventListener("abort", cancel); throw error; }
    // Completion is internally handled: detached work never causes an unhandled rejection.
    void (async () => {
      try {
        const result = await work(job.controller.signal, emit, jobId);
        job.controller.signal.throwIfAborted();
        job.snapshot.result = bounded(result, JOB_LIMITS.resultCharacters).data;
        job.snapshot.status = "completed";
        if (options.kind === "shell" && result && typeof result === "object" && "exitCode" in result && (result.exitCode !== 0 || ("timedOut" in result && result.timedOut === true))) {
          job.snapshot.status = "failed";
          job.snapshot.error = "Shell exited unsuccessfully; inspect its result.";
        }
      } catch {
        job.snapshot.status = job.controller.signal.aborted ? "cancelled" : "failed";
        job.snapshot.error = job.snapshot.status === "cancelled" ? "Job cancelled." : "Job execution failed; inspect recorded events.";
      } finally {
        options.signal?.removeEventListener("abort", cancel);
        try { emit(job.snapshot.status, job.snapshot); }
        catch { job.snapshot.status = "failed"; job.snapshot.error = "Job event persistence failed."; }
        if (job.snapshot.background) this.notifications.push(structuredClone(job.snapshot));
        job.resolveDone();
        for (const listener of [...job.listeners]) listener();
      }
    })();
    return structuredClone(job.snapshot);
  }
  list(): JobSnapshot[] { return [...this.jobs.values()].map(job => structuredClone(job.snapshot)); }
  get(id: string): JobSnapshot { return structuredClone(this.require(id).snapshot); }
  private require(id: string): Job { const job = this.jobs.get(id); if (!job) throw new Error("Unknown job in this session."); return job; }
  cancel(id: string): void { this.require(id).controller.abort(); }
  cancelAll(): void { for (const job of this.jobs.values()) if (job.snapshot.status === "running") job.controller.abort(); }
  async settle(): Promise<void> { await Promise.all([...this.jobs.values()].map(job => job.done)); }
  detach(id: string): JobSnapshot {
    const job = this.require(id);
    if (!job.snapshot.background && job.snapshot.status === "running") {
      job.snapshot.background = true;
      const event: JobEvent = { seq: job.nextSeq++, jobId: id, kind: job.snapshot.kind, type: "background", time: Date.now(), data: { background: true }, truncated: false };
      job.events.push(event); if (job.events.length > JOB_LIMITS.events) job.events.shift(); job.snapshot.lastSeq = event.seq;
      this.onEvent?.(structuredClone(event));
      for (const listener of [...job.listeners]) listener();
    }
    return structuredClone(job.snapshot);
  }
  async foreground(id: string, signal?: AbortSignal): Promise<unknown> {
    const job = this.require(id);
    while (job.snapshot.status === "running" && !job.snapshot.background) await this.changed(job, JOB_LIMITS.waitMs, signal);
    if (job.snapshot.background) return structuredClone(job.snapshot);
    if (job.snapshot.status !== "completed" && !(job.snapshot.kind === "shell" && job.snapshot.status === "failed" && job.snapshot.result !== undefined)) throw new Error(job.snapshot.error);
    return structuredClone(job.snapshot.result);
  }
  private async changed(job: Job, timeout: number, signal?: AbortSignal): Promise<void> {
    let wake!: () => void;
    const pending = new Promise<void>(resolve => { wake = resolve; });
    job.listeners.add(wake);
    const timer = setTimeout(wake, timeout);
    try { await abortable(pending, signal); }
    finally { clearTimeout(timer); job.listeners.delete(wake); }
  }
  async subscribe(input: JobInput, signal?: AbortSignal): Promise<{ job: JobSnapshot; events: JobEvent[]; missed: boolean }> {
    input = parse(input);
    const job = this.require(input.jobId); const after = input.after ?? -1;
    if (job.snapshot.status === "running" && job.snapshot.lastSeq <= after && (input.waitMs ?? 0) > 0) await this.changed(job, input.waitMs!, signal);
    return { job: structuredClone(job.snapshot), events: structuredClone(job.events.filter(event => event.seq > after)), missed: after < (job.events[0]?.seq ?? 0) - 1 };
  }
  async nextNotifications(signal?: AbortSignal): Promise<JobSnapshot[]> {
    if (!this.notifications.length) {
      const running = [...this.jobs.values()].filter(job => job.snapshot.background && job.snapshot.status === "running");
      if (running.length) await abortable(Promise.race(running.map(job => job.done)), signal);
    }
    return this.notifications.splice(0);
  }
  resetRun(): void {
    if (this.list().some(job => job.status === "running")) throw new Error("Cannot reset running jobs.");
    this.jobs.clear(); this.notifications = [];
  }
  tools(): ToolDefinition<JobInput, unknown>[] {
    const schema = { type: "object", properties: { jobId: { type: "string" }, action: { type: "string", enum: ["status", "cancel", "background"] }, after: { type: "integer", minimum: -1 }, waitMs: { type: "integer", minimum: 0, maximum: JOB_LIMITS.waitMs } }, required: ["jobId"], additionalProperties: false };
    // Job events are consumed through the runtime `subscribe` tool (topic "job").
    return [defineTool({ name: "job", concurrency: "exclusive", description: "Get a job result/status, cancel a session job, or convert a running foreground job to background. Background completions notify the parent model automatically.", inputSchema: schema, parseInput: parse, assessRisk: () => ({ kind: "safe", reason: "Manage a session job." }), execute: input => { if (input.action === "cancel") this.cancel(input.jobId); if (input.action === "background") return this.detach(input.jobId); return this.get(input.jobId); } })];
  }
}
