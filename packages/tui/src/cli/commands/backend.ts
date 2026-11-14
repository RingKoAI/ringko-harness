import { defaultProjectWorkspace } from "@ringko-ai/config";
import { canonicalWorkspace, sharedPort } from "@ringko-ai/client/local";
import { VERSION, LICENSE } from "../../version.ts";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

/** Internal detached worker. Frontends hold leases; this process owns execution. */
export async function serveBackendCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const { startServer } = await import("@ringko-ai/app");
  const config = readConfig(parsed, io); if (!config) return 2;
  const workspace = canonicalWorkspace(parsed.workspace ?? config.workspace ?? defaultProjectWorkspace(process.cwd(), process.env).path);
  const server = startServer({ workspace, configPath: parsed.config, port: parsed.port ?? sharedPort(workspace, parsed.config), managed: true, shared: parsed.shared,
    authToken: process.env.RINGKO_WEB_TOKEN?.trim(), version: VERSION, license: LICENSE });
  io.out(`Shared backend: ${server.url}`);
  const shutdown = () => { void server.stop().catch(error => io.err(String(error))); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  try {
    const result = await server.closed;
    if (result.timedOut || result.errors.length) { io.err(`Backend shutdown: timedOut=${result.timedOut}, errors=${result.errors.length}.`); return 1; }
    return 0;
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}
