// Contribution registry.
//
// RuntimeManager creates one ExtensionRegistry and supplies the shared
// RuntimeContext. The registry owns contribution lifecycle and agent-scoped
// handlers; it never discovers plugins or assembles tools itself.

import type { RingkoConfig } from "@ringko-ai/config";
import { writeDiagnostic } from "@ringko-ai/config";
import type { RingKo } from "./index.ts";
import type {
  AgentContribution,
  AgentContributionContext,
  Disposable,
  RuntimeContext,
  RuntimeContribution,
} from "./runtime-contribution.ts";

interface Entry {
  dispose?: Disposable;
  handlers: Set<AgentContribution>;
}

export class ExtensionRegistry {
  private readonly contributions = new Map<string, Entry>();
  private readonly agentHandlers = new Set<AgentContribution>();
  private closed = false;

  constructor(private readonly contextFactory: (handlers: Set<AgentContribution>) => RuntimeContext) {}

  /** Register a contribution synchronously (used for built-ins during construction). */
  install(contribution: RuntimeContribution): void {
    const { name, handlers, context } = this.begin(contribution);
    let result: void | Disposable | Promise<void | Disposable>;
    try {
      result = contribution.setup(context);
    } catch (error) {
      this.rollback(handlers);
      throw error;
    }
    if (result instanceof Promise) {
      this.rollback(handlers);
      throw new TypeError(`Runtime contribution "${name}" must be synchronous during construction.`);
    }
    this.contributions.set(name, { ...(typeof result === "function" ? { dispose: result } : {}), handlers });
  }

  /** Register a contribution asynchronously and return an idempotent disposer. */
  async use(contribution: RuntimeContribution): Promise<Disposable> {
    const { name, handlers, context } = this.begin(contribution);
    let dispose: Disposable | undefined;
    try {
      const result = await contribution.setup(context);
      if (typeof result === "function") dispose = result;
    } catch (error) {
      this.rollback(handlers);
      throw error;
    }
    this.contributions.set(name, { ...(dispose ? { dispose } : {}), handlers });
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      this.contributions.delete(name);
      this.rollback(handlers);
      await dispose?.();
    };
  }

  /** Add one agent handler to a contribution's ownership set. */
  add(handlers: Set<AgentContribution>, handler: AgentContribution): Disposable {
    if (this.closed) throw new Error("Runtime is closed.");
    this.agentHandlers.add(handler);
    handlers.add(handler);
    return () => {
      this.agentHandlers.delete(handler);
      handlers.delete(handler);
    };
  }

  /** Apply every agent handler in registration order. */
  apply(agent: RingKo, config: RingkoConfig, context: AgentContributionContext): Disposable[] {
    if (this.closed) throw new Error("Runtime is closed.");
    const disposers: Disposable[] = [];
    for (const handler of this.agentHandlers) {
      const dispose = handler(agent, config, context);
      if (typeof dispose === "function") disposers.push(dispose);
    }
    return disposers;
  }

  /** Dispose contributions in reverse registration order. */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const contributions = [...this.contributions.values()].reverse();
    this.contributions.clear();
    this.agentHandlers.clear();
    for (const contribution of contributions) {
      contribution.handlers.clear();
      try { await contribution.dispose?.(); }
      catch (error) { writeDiagnostic("runtime.contribution", String(error)); }
    }
  }

  private begin(contribution: RuntimeContribution): { name: string; handlers: Set<AgentContribution>; context: RuntimeContext } {
    if (this.closed) throw new Error("Runtime is closed.");
    const name = typeof contribution?.name === "string" ? contribution.name.trim() : "";
    if (name.length === 0) throw new TypeError("Runtime contribution requires a name.");
    if (this.contributions.has(name)) throw new Error(`Runtime contribution "${name}" is already registered.`);
    const handlers = new Set<AgentContribution>();
    return { name, handlers, context: this.contextFactory(handlers) };
  }

  private rollback(handlers: Set<AgentContribution>): void {
    for (const handler of handlers) this.agentHandlers.delete(handler);
    handlers.clear();
  }
}
