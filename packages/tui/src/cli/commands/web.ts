import { resolve } from "node:path";
import { defaultProjectWorkspace } from "@ringko-ai/config";
import { canonicalWorkspace, sharedPort } from "@ringko-ai/client/local";
import { RuntimeSupervisor } from "@ringko-ai/sdk/runtime";
import { findLiveBackend } from "../../backend.ts";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

const REUSE_WAIT_MS = 5_000;
const REUSE_POLL_MS = 200;

export async function webCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const { startServer } = await import("@ringko-ai/app");
  const config = readConfig(parsed, io);
  if (!config) return 2;
  let workspace: string;
  try {
    workspace = canonicalWorkspace(parsed.workspace ?? config.workspace ?? defaultProjectWorkspace(process.cwd(), process.env).path);
  } catch {
    io.err("Workspace does not exist.");
    return 1;
  }
  const configPath = parsed.config ? resolve(parsed.config) : undefined;
  const envPort = process.env.RINGKO_PORT ? Number(process.env.RINGKO_PORT) : undefined;
  const port = parsed.port ?? (Number.isInteger(envPort) && envPort! > 0 && envPort! <= 65_535 ? envPort! : sharedPort(workspace, configPath));

  // One backend owns each workspace/config pair; a second `web` attaches to it.
  const existing = await findLiveBackend({ workspace, configPath });
  if (existing) {
    io.out(`RingKo backend / WebUI: ${existing.url}`);
    io.out("Already running; reusing the existing backend.");
    return 0;
  }
  let server;
  const runtimeHost = new RuntimeSupervisor({ ...(configPath ? { configPath } : {}) });
  try {
    server = startServer({ workspace, port, configPath, shared: parsed.shared, authToken: process.env.RINGKO_WEB_TOKEN?.trim(), runtimeHost });
  } catch (error) {
    void runtimeHost.close();
    // A client may be starting the same owner right now; wait for it instead
    // of failing on a transient port/registration conflict.
    const deadline = Date.now() + REUSE_WAIT_MS;
    while (Date.now() < deadline) {
      const running = await findLiveBackend({ workspace, configPath });
      if (running) {
        io.out(`RingKo backend / WebUI: ${running.url}`);
        io.out("Already running; reusing the existing backend.");
        return 0;
      }
      await new Promise(wait => setTimeout(wait, REUSE_POLL_MS));
    }
    io.err(error instanceof Error ? error.message : "Backend startup failed.");
    return 1;
  }
  io.out(`RingKo backend / WebUI: ${server.url}`);
  await new Promise<void>(finish => {
    const shutdown = () => {
      process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown);
      void server.stop().then(result => {
        if (result.timedOut) io.err(`Shutdown timed out; still settling: ${result.pendingRuns.join(", ") || "(runtime resources)"}`);
        if (result.errors.length > 0) io.err(`Shutdown completed with ${result.errors.length} error(s).`);
        finish();
      }).catch(error => { io.err(`Shutdown failed: ${String(error)}`); finish(); });
    };
    process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  });
  return 0;
}
