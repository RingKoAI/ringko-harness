import { resolve } from "node:path";
import { defaultProjectWorkspace } from "@ringko-ai/config";
import { findLiveBackend } from "../../backend.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

export async function serveCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const { startServer } = await import("@ringko-ai/app");
  const workspace = parsed.workspace ? resolve(parsed.workspace) : defaultProjectWorkspace(process.cwd(), process.env).path;
  const configPath = parsed.config ? resolve(parsed.config) : undefined;
  // One backend owns each workspace/config pair; a second `serve` attaches to it.
  const existing = await findLiveBackend({ workspace, configPath });
  if (existing) {
    io.out(`RingKo backend / WebUI: ${existing.url}`);
    io.out("Already running; reusing the existing backend.");
    return 0;
  }
  let server;
  try {
    server = startServer({ workspace, port: parsed.port, configPath, shared: parsed.shared, authToken: process.env.RINGKO_WEB_TOKEN?.trim() });
  } catch (error) {
    const running = await findLiveBackend({ workspace, configPath });
    if (running) {
      io.out(`RingKo backend / WebUI: ${running.url}`);
      io.out("Already running; reusing the existing backend.");
      return 0;
    }
    io.err(error instanceof Error ? error.message : "Backend startup failed.");
    return 1;
  }
  io.out(`RingKo backend / WebUI: ${server.url}`);
  await new Promise<void>(finish => {
    const shutdown = () => { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); server.stop(); finish(); };
    process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  });
  return 0;
}
