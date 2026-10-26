// Compaction shape shared by the in-memory history and log replay.
//
// The log records the surface span a compaction replaced. The live history is
// derived from that replacement record instead of being assembled separately,
// so a restart reproduces the same summary, retained tail, and tool pairing
// that the running process used.
import type { ChatMessage } from "@ringko-ai/harness";

/** Recent messages kept after a compaction when the event does not record one. */
export const DEFAULT_KEEP_RECENT = 6;

/** One current model-visible message together with the log seq that produced it. */
export interface SurfaceNode {
  seq: number;
  message: ChatMessage;
  /** True when this node is a compaction checkpoint rather than host context. */
  summary?: true;
}

/** The system message that replaces the compacted span of the conversation. */
export function compactionSummaryContent(summary: string): string {
  return `Conversation summary so far:\n${summary}`;
}

/**
 * Where the kept window may safely start.
 *
 * A cut inside a tool call/result run leaves orphan tool results: the assistant
 * turn carrying their `toolCalls` was summarized away, and providers reject a
 * `tool` message that does not answer a preceding `tool_calls` (HTTP 400). The
 * window therefore never starts on a tool result; it slides back to the
 * assistant turn that owns the run.
 */
export function safeHistoryCut(messages: readonly ChatMessage[], desired: number): number {
  const balance = new Array<number>(messages.length + 1).fill(0);
  for (let index = 0; index < messages.length; index += 1) {
    balance[index + 1] = balance[index]! + openToolCalls(messages[index]!);
  }
  let index = Math.max(0, Math.min(desired, messages.length));
  while (index > 0 && balance[index] !== 0) index -= 1;
  return index;
}

/** How one surface message changes the number of open assistant tool calls. */
function openToolCalls(message: ChatMessage): number {
  if (message.role === "assistant") return message.toolCalls?.length ?? 0;
  return message.role === "tool" ? -1 : 0;
}

/**
 * Split a current surface into the prefix replaced by a summary and the
 * verbatim tail retained after it.
 *
 * The tail starts at the latest safe cut at or before the requested retention
 * boundary. A safe cut has no assistant tool call crossing it, so a tool result
 * never survives without the assistant message that issued its call. A leading
 * non-checkpoint system message is treated as a stable head; an earlier
 * checkpoint remains replaceable so repeated compactions do not accumulate.
 */
export function selectCompactionTail(
  nodes: readonly SurfaceNode[],
  keepRecent: number,
): { shadowed: SurfaceNode[]; retained: SurfaceNode[] } | undefined {
  if (nodes.length === 0) return undefined;
  const head = nodes[0]!;
  const first = head.message.role === "system" && head.summary !== true ? 1 : 0;
  const balance = new Array<number>(nodes.length + 1).fill(0);
  for (let index = 0; index < nodes.length; index += 1) {
    const next = balance[index]! + openToolCalls(nodes[index]!.message);
    if (next < 0) return undefined;
    balance[index + 1] = next;
  }
  let cut = Math.max(first, nodes.length - Math.max(0, keepRecent));
  while (cut > first && balance[cut] !== 0) cut -= 1;
  if (cut <= first) return undefined;
  return { shadowed: nodes.slice(first, cut), retained: nodes.slice(cut) };
}

/**
 * Build the compacted history: every system message (instructions, prior
 * summaries, notifications), then the summary standing in for the compacted
 * span, then the recent tail starting at a tool-pairing-safe cut.
 */
export function compactMessages(
  messages: readonly ChatMessage[],
  summary: string,
  keepRecent: number = DEFAULT_KEEP_RECENT,
): ChatMessage[] {
  const systems = messages.filter((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  const keep = Math.max(0, keepRecent);
  const cut = safeHistoryCut(rest, rest.length - keep);
  const result: ChatMessage[] = [...systems];
  if (summary.length > 0) result.push({ role: "system", content: compactionSummaryContent(summary) });
  result.push(...rest.slice(cut));
  return result;
}
