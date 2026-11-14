import { defaultProjectWorkspace, writeDiagnostic } from "@ringko-ai/config";
import { attachFrontend } from "@ringko-ai/client";
import { connectBackend } from "../../backend.ts";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

/** A foreground Web owner enables pages and holds a lease, never a second engine. */
export async function webCommand(parsed: ParsedArgs, io: CliIo, options: { signal?: AbortSignal } = {}): Promise<number> {
  const config = readConfig(parsed, io); if (!config) return 2;
  if (options.signal?.aborted) return 0;
  try {
    const envPort = Number(process.env.RINGKO_PORT);
    const connection = await connectBackend({ workspace: parsed.workspace ?? config.workspace ?? defaultProjectWorkspace(process.cwd(), process.env).path,
      configPath: parsed.config, url: parsed.server, shared: parsed.shared, port: parsed.port ?? (Number.isInteger(envPort) && envPort > 0 && envPort <= 65_535 ? envPort : undefined) });
    const lease = await attachFrontend(connection.client, "web");
    const stopped = Promise.withResolvers<void>();
    const shutdown = () => stopped.resolve();
    process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
    options.signal?.addEventListener("abort", shutdown, { once: true });
    try {
      io.out(`RingKo WebUI: ${connection.url}`);
      io.out("Connected to the shared backend. Keep this Web frontend running; Ctrl+C closes only this frontend.");
      if (options.signal?.aborted) stopped.resolve();
      const result = await Promise.race([stopped.promise.then(() => undefined), lease.lost]);
      if (result) { io.err(result.message); return 1; }
      return 0;
    } finally {
      process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); options.signal?.removeEventListener("abort", shutdown);
      await lease.close().catch(error => writeDiagnostic("frontend.web.release", String(error)));
    }
  } catch (error) { io.err(error instanceof Error ? error.message : "Cannot start Web frontend."); return 1; }
}
