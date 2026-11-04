import { loadConfig, type RingkoConfig } from "@ringko-ai/config";
import type { CliIo, ParsedArgs } from "./types.ts";

export function readConfig(parsed: ParsedArgs, io: CliIo): RingkoConfig | undefined {
  try {
    return loadConfig({ path: parsed.config });
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid config.");
    return undefined;
  }
}
