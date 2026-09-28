// Append-only event log with cursor-based subscription.
//
// Every event carries a monotonic `seq`. Subscribers read events after a cursor
// and can long-poll (`waitMs`) for the next batch. This is the substrate for the
// model-facing `subscribe` tool: it can watch `time` ticks, session events, or
// any topic a producer appends.
export interface RuntimeEvent {
  seq: number;
  topic: string;
  time: number;
  data: unknown;
}

export interface SubscribeOptions {
  /** Topics to include; empty/undefined means all. */
  topics?: readonly string[];
  /** Exclusive cursor: only events with `seq > after`. Defaults to -1 (all). */
  after?: number;
  /** Long-poll: wait up to this many ms for new matching events. Default 0. */
  waitMs?: number;
  /** Maximum events returned (default 100). */
  limit?: number;
}

export interface SubscribeResult {
  events: RuntimeEvent[];
  /** The log's latest seq (a good `after` for the next call). */
  lastSeq: number;
  /** True when `after` predates the retained window (events were dropped). */
  missed: boolean;
}

export class EventLog {
  private readonly events: RuntimeEvent[] = [];
  private readonly waiters = new Set<() => void>();
  private nextSeq = 0;

  /** Append an event; returns it with its assigned `seq`. */
  append(topic: string, data?: unknown, time: number = Date.now()): RuntimeEvent {
    const event: RuntimeEvent = { seq: this.nextSeq, topic, time, data };
    this.nextSeq += 1;
    this.events.push(event);
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter();
    }
    return event;
  }

  /** All recorded events (append order). */
  all(): readonly RuntimeEvent[] {
    return this.events;
  }

  /** The latest assigned seq, or -1 when empty. */
  get lastSeq(): number {
    return this.nextSeq - 1;
  }

  private collect(options: SubscribeOptions): RuntimeEvent[] {
    const after = typeof options.after === "number" ? options.after : -1;
    const topics = options.topics && options.topics.length > 0 ? new Set(options.topics) : undefined;
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    return this.events
      .filter((event) => event.seq > after && (!topics || topics.has(event.topic)))
      .slice(0, limit);
  }

  /** Read matching events now, or long-poll up to `waitMs` for the first new one. */
  async subscribe(options: SubscribeOptions = {}): Promise<SubscribeResult> {
    let matched = this.collect(options);
    const waitMs = options.waitMs ?? 0;
    if (matched.length === 0 && waitMs > 0) {
      await this.waitForChange(waitMs);
      matched = this.collect(options);
    }
    const oldest = this.events[0]?.seq;
    const after = typeof options.after === "number" ? options.after : -1;
    const missed = oldest !== undefined && after >= 0 && after < oldest - 1;
    return { events: matched, lastSeq: this.lastSeq, missed };
  }

  private waitForChange(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const settle = (): void => {
        this.waiters.delete(settle);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(settle, ms);
      timer.unref?.();
      this.waiters.add(settle);
    });
  }

  /** Wake every pending long-poll (e.g. on shutdown). */
  wakeAll(): void {
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter();
    }
  }
}
