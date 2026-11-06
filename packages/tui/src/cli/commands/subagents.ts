import { buildSubagentProviders } from "@ringko-ai/sdk/subagents";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

/** List the configured subagent providers and their continuation capabilities. */
export function subagentsCommand(parsed: ParsedArgs, io: CliIo): number {
  const config = readConfig(parsed, io);
  if (!config) return 2;
  let built;
  try { built = buildSubagentProviders(config.subagents); }
  catch (error) { io.err(error instanceof Error ? error.message : "Invalid subagent configuration."); return 1; }
  for (const provider of built.providers) {
    const capabilities = [
      provider.capabilities.continuable ? "continuable" : undefined,
      provider.capabilities.resume ? "resume" : undefined,
      provider.capabilities.modelSelection ? "model" : undefined,
      provider.capabilities.tools ? "tools" : undefined,
      provider.capabilities.approvals ? "approvals" : undefined,
    ].filter(Boolean).join(",");
    const marker = provider.name === built.defaultProvider ? "*" : " ";
    io.out(`${marker} ${provider.name}\t${provider.kind}\t${capabilities || "-"}\t${provider.description}`);
  }
  return 0;
}
