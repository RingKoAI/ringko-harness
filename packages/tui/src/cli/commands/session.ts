import { SessionStore } from "@ringko-ai/session";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

export function sessionCommand(parsed: ParsedArgs, io: CliIo): number {
  if (parsed.positionals.length > 1 || parsed.positionals[0] !== undefined && parsed.positionals[0] !== "list") {
    io.err("Usage: ringko session list [--workspace <dir>]"); return 2;
  }
  const config = readConfig(parsed, io); if (!config) return 2;
  const cwd = parsed.workspace ?? config.workspace;
  for (const meta of new SessionStore({ ...(cwd ? { cwd } : {}) }).list()) {
    io.out(`${meta.id}\t${new Date(meta.header.createdAt).toISOString()}\t${meta.header.cwd ?? ""}`);
  }
  return 0;
}
