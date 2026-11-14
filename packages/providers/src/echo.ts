import type { ModelClient } from "@ringko-ai/harness";

/** Deterministic offline provider for first-run setup and pipeline verification. */
export function createEchoProvider(): ModelClient {
  return async request => ({ content: `echo: ${request.messages.at(-1)?.content ?? ""}`, toolCalls: [] });
}
