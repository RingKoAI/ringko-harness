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
}

/** Render the interactive REPL and resolve when it exits. */
export async function launchRepl(options: LaunchReplOptions): Promise<void> {
  const app = render(createElement(Repl, options));
  await app.waitUntilExit();
}

export { Repl } from "./app.tsx";
