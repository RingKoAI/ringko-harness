import { resolve } from "node:path";
import { defaultProjectWorkspace, selectModel, type RingkoConfig } from "@ringko-ai/config";
import type { BackendClient } from "@ringko-ai/client";
import { connectBackend } from "../../backend.ts";
import { cliCommand } from "../../cli-identity.ts";
import { printResumeHint } from "../../resume-hint.ts";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

interface ReplModule {
  launchRepl(options: {
    model: import("@ringko-ai/sdk").ModelClient;
    modelLabel: string;
    config: RingkoConfig;
    workspace: string;
    createModel?: (config: RingkoConfig) => Promise<import("@ringko-ai/sdk").ModelClient | string>;
    resumeSessionId?: string;
    modelId?: string;
    pickSession?: boolean;
    smallModel?: import("@ringko-ai/sdk").ModelClient;
    backend?: BackendClient;
  }): Promise<string | undefined>;
}

export async function tuiCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (!process.stdout.isTTY) {
    io.err(`${cliCommand()} requires an interactive terminal; use ${cliCommand()} serve for the browser UI.`);
    return 1;
  }
  const config = readConfig(parsed, io);
  if (!config) return 2;
  const workspace = parsed.workspace ?? config.workspace ?? defaultProjectWorkspace(process.cwd(), process.env).path;
  let connection: Awaited<ReturnType<typeof connectBackend>>;
  try { connection = await connectBackend({ workspace, configPath: parsed.config, url: parsed.server }); }
  catch (error) { io.err(error instanceof Error ? error.message : "Cannot connect backend."); return 1; }
  const backend = connection.client;
  io.out(`Shared backend: ${connection.url}`);
  const sessions = await backend.sessions();
  const resumeSessionId = parsed.session ?? (parsed.resume ? sessions[0]?.id : undefined);
  if (parsed.model || parsed.provider) {
    const selection = selectModel(config, { ...(parsed.provider ? { provider: parsed.provider } : {}), ...(parsed.model ? { model: parsed.model } : {}) });
    if (!selection) { io.err("Unknown model/provider override."); return 2; }
    await backend.request("/api/model", { model: `${selection.provider.name}/${selection.model.id}` });
  }
  const info = await backend.request<{ model: string | null; modelId: string | null }>("/api/info");

  let repl: ReplModule;
  try {
    repl = (await import("@ringko-ai/repl")) as ReplModule;
  } catch (error) {
    io.err(`Cannot load @ringko-ai/repl: ${(error as Error).message}`);
    return 1;
  }
  const sessionId = await repl.launchRepl({
    // Compatibility for embedded REPL hosts; the shared TUI never invokes this model.
    model: async () => { throw new Error("Model execution belongs to the shared backend."); },
    modelLabel: info.model ?? "No model configured",
    config,
    workspace: connection.workspace,
    backend,
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(parsed.sessionPicker ? { pickSession: true } : {}),
    ...(info.modelId ? { modelId: info.modelId } : {}),
  });
  if (sessionId && (await backend.sessions()).some(session => session.id === sessionId)) {
    printResumeHint(io, sessionId, resolve(workspace), process.argv[1]);
  }
  return 0;
}
