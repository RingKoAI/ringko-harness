import { SessionStore } from "@ringko-ai/session";
import type { CliIo } from "../types.ts";

export function sessionCommand(io: CliIo): number {
  for (const meta of new SessionStore().list()) {
    io.out(`${meta.id}\t${new Date(meta.header.createdAt).toISOString()}\t${meta.header.cwd ?? ""}`);
  }
  return 0;
}
