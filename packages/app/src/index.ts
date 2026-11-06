import type { RingKoConfig } from "@ringko-ai/sdk";
import { RuntimeManager } from "@ringko-ai/sdk/runtime";

export * from "./server.ts";
export * from "./model.ts";

export interface AppOptions extends RingKoConfig {
  workspace: string;
}

export interface RingKoApp {
  readonly workspace: string;
  run(prompt: string): Promise<string>;
  /** Close the runtime, agent and MCP connections. */
  close(): Promise<void>;
}

/** Embedded host entry: boot the framework runtime around one workspace. */
export function createApp(options: AppOptions): RingKoApp {
  const { workspace, ...config } = options;
  const runtime = new RuntimeManager(workspace);
  const managed = runtime.createAgent({}, config);
  let closed = false;
  return {
    workspace,
    async run(prompt) {
      return (await managed.agent.run(prompt)).content;
    },
    async close() {
      if (closed) return;
      closed = true;
      const errors: unknown[] = [];
      try { await managed.close(); } catch (error) { errors.push(error); }
      try { await runtime.close(); } catch (error) { errors.push(error); }
      if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "App close failed.");
    },
  };
}
