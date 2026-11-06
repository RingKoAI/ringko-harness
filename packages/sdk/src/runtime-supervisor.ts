// Process-level runtime host.
//
// A host binary creates one supervisor and passes it to the transport/host
// layer. The supervisor owns one RuntimeManager per workspace and closes them
// together, so runtime lifecycle starts at the main entry instead of being
// hidden inside HTTP handlers or UI effects.

import { resolve } from "node:path";
import { EventLog } from "@ringko-ai/runtime";
import { RuntimeManager } from "./runtime.ts";

export interface RuntimeSupervisorOptions {
  /** Shared event log for every runtime; created when omitted. */
  log?: EventLog;
  /** Explicit settings file used for plugin trust and capabilities. */
  configPath?: string;
}

export class RuntimeSupervisor {
  readonly log: EventLog;
  private readonly runtimes = new Map<string, RuntimeManager>();
  private closing?: Promise<void>;
  private closed = false;

  constructor(private readonly options: RuntimeSupervisorOptions = {}) {
    this.log = options.log ?? new EventLog();
  }

  /** Get or create the runtime for an absolute or relative workspace. */
  get(workspace: string): RuntimeManager {
    if (this.closed) throw new Error("Runtime supervisor is closed.");
    if (typeof workspace !== "string" || !workspace.trim()) throw new TypeError("Runtime supervisor requires a workspace.");
    const path = resolve(workspace);
    let runtime = this.runtimes.get(path);
    if (!runtime) {
      runtime = new RuntimeManager(path, this.log, this.options.configPath);
      this.runtimes.set(path, runtime);
    }
    return runtime;
  }

  list(): RuntimeManager[] {
    return [...this.runtimes.values()];
  }

  /** Close every runtime exactly once; later calls await the same promise. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    this.closing = Promise.allSettled(runtimes.map(runtime => runtime.close())).then(results => {
      const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Runtime supervisor close failed.");
    });
    return this.closing;
  }
}
