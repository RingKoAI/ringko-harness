import { render } from "ink";
import { createElement } from "react";
import type { ModelClient } from "@ringko-ai/sdk";
import type { RingkoConfig } from "@ringko-ai/config";
import { Repl } from "./app.tsx";

export interface LaunchReplOptions {
  model: ModelClient;
  modelLabel: string;
  config: RingkoConfig;
  workspace: string;
  /** Rebuild a model client from a config (used by /connect). */
  createModel?: (config: RingkoConfig) => Promise<ModelClient | string>;
  /** Continue an existing session (resume). */
  resumeSessionId?: string;
  /** Model id sent in requests (recorded as invocation history). */
  modelId?: string;
  /** Open the session picker on start. */
  pickSession?: boolean;
  /** Optional cheaper model for helper tasks (session title). */
  smallModel?: ModelClient;
}

/** Render the interactive REPL and resolve with the final session id on exit. */
export async function launchRepl(options: LaunchReplOptions): Promise<string | undefined> {
  let lastSessionId: string | undefined;
  const app = render(
    createElement(Repl, {
      ...options,
      onSession: (id: string) => {
        lastSessionId = id;
      },
    }),
    // Ctrl+C is handled in-app (clear input); exit via /exit.
    { exitOnCtrlC: false },
  );
  await app.waitUntilExit();
  return lastSessionId;
}
