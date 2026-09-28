// Event runtime kernel: one bus with the four dispatch semantics dsh uses.
//
// - emit:      fire-and-forget; the event is not mutated.
// - parallel:  await every listener (order-independent).
// - serial:    await listeners in registration order.
// - waterfall: chain listeners; each receives `next` and must call it to delegate.
//
// A listener returns a disposer from `on`, so features (workflows, permissions,
// plugins) can register and unregister contributions independently.
export type Unsubscribe = () => void;

type AnyListener = (event: unknown, next?: (event?: unknown) => Promise<unknown>) => unknown;

export class EventBus<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<string, AnyListener[]>();

  /** Register a listener; returns a disposer. */
  on<K extends keyof Events & string>(name: K, listener: (event: Events[K]) => void | Promise<void>): Unsubscribe {
    return this.add(name, listener as unknown as AnyListener);
  }

  /** Register a listener for waterfall dispatch (receives `next`). */
  onWaterfall<K extends keyof Events & string>(
    name: K,
    listener: (event: Events[K], next: (event?: Events[K]) => Promise<Events[K]>) => Events[K] | Promise<Events[K]>,
  ): Unsubscribe {
    return this.add(name, listener as unknown as AnyListener);
  }

  private add(name: string, listener: AnyListener): Unsubscribe {
    const list = this.listeners.get(name) ?? [];
    list.push(listener);
    this.listeners.set(name, list);
    return () => {
      const current = this.listeners.get(name);
      if (!current) return;
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
    };
  }

  private snapshot(name: string): AnyListener[] {
    return [...(this.listeners.get(name) ?? [])];
  }

  /** Count registered listeners for an event. */
  count<K extends keyof Events & string>(name: K): number {
    return (this.listeners.get(name) ?? []).length;
  }

  /** Fire-and-forget: invoke listeners without awaiting or mutating the event. */
  emit<K extends keyof Events & string>(name: K, event: Events[K]): void {
    for (const listener of this.snapshot(name)) {
      try {
        void listener(event);
      } catch {
        // emit never propagates listener failures
      }
    }
  }

  /** Await every listener; a rejection propagates. */
  async parallel<K extends keyof Events & string>(name: K, event: Events[K]): Promise<void> {
    await Promise.all(this.snapshot(name).map((listener) => Promise.resolve(listener(event))));
  }

  /** Await listeners in registration order; the first rejection stops the chain. */
  async serial<K extends keyof Events & string>(name: K, event: Events[K]): Promise<void> {
    for (const listener of this.snapshot(name)) {
      await listener(event);
    }
  }

  /**
   * Chain listeners over one mutable event. Each listener receives `next` and
   * must call it (with an optional replacement) to delegate; returning without
   * calling `next` short-circuits the remaining listeners. The final event is
   * returned. A listener that never calls `next` ends the chain at its value.
   */
  async waterfall<K extends keyof Events & string>(name: K, event: Events[K]): Promise<Events[K]> {
    const chain = this.snapshot(name);
    let index = 0;
    const dispatch = async (current: Events[K]): Promise<Events[K]> => {
      const listener = chain[index];
      index += 1;
      if (!listener) return current;
      const next = async (replacement?: Events[K]): Promise<Events[K]> =>
        dispatch(replacement === undefined ? current : replacement);
      const result = (await listener(
        current,
        next as unknown as (event?: unknown) => Promise<unknown>,
      )) as Events[K] | undefined;
      return result === undefined ? current : result;
    };
    return await dispatch(event);
  }
}

export * from "./log.ts";
export * from "./subscribe.ts";
export * from "./time.ts";
export * from "./schedule.ts";
export * from "./schedule-tool.ts";
