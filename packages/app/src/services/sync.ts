import { randomUUID } from "node:crypto";
import { SYNC_LIMITS, type SyncNotice } from "@ringko-ai/protocol";

/** Small invalidation events; snapshots remain the source of truth, not an unbounded replay buffer. */
export class SyncManager {
  readonly instance = randomUUID();
  revision = 0;
  private readonly subscribers = new Set<{ send(notice: SyncNotice): void; close(): void }>();
  publish(kind: SyncNotice["kind"], sessionId?: string): void {
    const notice: SyncNotice = { instance: this.instance, revision: ++this.revision, kind, ...(sessionId ? { sessionId } : {}) };
    for (const subscriber of [...this.subscribers]) subscriber.send(notice);
  }
  stream(signal: AbortSignal): Response {
    if (this.subscribers.size >= SYNC_LIMITS.subscribers) return Response.json({ error: "Too many sync clients." }, { status: 429 });
    let dispose: () => void = () => {};
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true; clearInterval(heartbeat); signal.removeEventListener("abort", close);
          this.subscribers.delete(subscriber);
          try { controller.close(); } catch { /* Consumer already detached. */ }
        };
        const enqueue = (text: string) => {
          if (closed) return;
          if ((controller.desiredSize ?? 0) < 0) { close(); return; }
          try { controller.enqueue(encoder.encode(text)); } catch { close(); }
        };
        const subscriber = { send: (notice: SyncNotice) => enqueue(`event: sync\ndata: ${JSON.stringify(notice)}\n\n`), close };
        const heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), SYNC_LIMITS.heartbeatMs);
        heartbeat.unref?.();
        this.subscribers.add(subscriber); dispose = close;
        signal.addEventListener("abort", close, { once: true });
        if (signal.aborted) close();
        else subscriber.send({ instance: this.instance, revision: this.revision, kind: "reset" });
      },
      cancel: () => dispose(),
    }, { highWaterMark: SYNC_LIMITS.queuedBytes, size: chunk => chunk?.byteLength ?? 0 });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }
  close(): void { for (const subscriber of [...this.subscribers]) subscriber.close(); }
}
