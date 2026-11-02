// Heuristic token estimation, used for compaction thresholds when a provider
// does not report usage. Approximate: ~4 Latin characters or ~1.5 CJK
// characters per token.
import type { ChatMessage } from "./agent.ts";
import type { ToolMetadata } from "./tools.ts";

function isCjk(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

/** Estimate the token count of a string. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let cjk = 0;
  for (const char of text) {
    if (isCjk(char.codePointAt(0) ?? 0)) cjk += 1;
  }
  const latin = text.length - cjk;
  return Math.ceil(latin / 4) + Math.ceil(cjk / 1.5);
}

/**
 * Conservative per-image budget. Providers derive image tokens from dimensions;
 * without decoding, a fixed estimate keeps compaction from under-counting a
 * large screenshot. Refine only with measured provider usage.
 */
const IMAGE_TOKEN_ESTIMATE = 1_600;

/** Estimate the token count of a message history (content, reasoning, tool calls). */
export function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokens(message.content);
    if (message.reasoning) total += estimateTokens(message.reasoning);
    if (message.name) total += estimateTokens(message.name);
    if (message.toolCallId) total += estimateTokens(message.toolCallId);
    if (message.toolCalls) total += estimateTokens(JSON.stringify(message.toolCalls));
    if (message.parts) {
      for (const part of message.parts) {
        if (part.type === "image") total += IMAGE_TOKEN_ESTIMATE;
      }
    }
  }
  return total;
}

/** Estimate the token count of the tool schemas declared to the model. */
export function estimateToolsTokens(tools: readonly ToolMetadata[]): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateTokens(tool.name) + estimateTokens(tool.description) + estimateTokens(JSON.stringify(tool.inputSchema));
  }
  return total;
}
