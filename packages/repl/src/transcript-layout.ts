import wrapAnsi from "wrap-ansi";
import { cleanTerminalText } from "./editor.ts";
import { toolResultSummary, truncate, type ReplItem } from "./state.ts";

export interface TranscriptLine { text: string; kind: ReplItem["kind"]; failed?: boolean; heading?: boolean }
/** Wrap by terminal cell width (including CJK), rather than code-unit length. */
export function transcriptLines(items: readonly ReplItem[], columns: number, expandThinking: boolean, expandTools: boolean): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const width = Math.max(1, columns);
  const append = (item: ReplItem, text: string, heading = false) => {
    for (const line of wrapAnsi(cleanTerminalText(text), width, { hard: true, trim: false }).split("\n"))
      lines.push({ text: line, kind: item.kind, failed: item.failed, heading });
  };
  for (const item of items) {
    if (item.kind === "user") { append(item, ""); append(item, `> ${item.text}`); }
    else if (item.kind === "assistant") append(item, item.text);
    else if (item.kind === "notice") append(item, item.text);
    else if (item.kind === "thinking") {
      append(item, expandThinking ? "Thinking" : "Thinking (Ctrl+T to expand)", true);
      if (expandThinking) append(item, item.text);
    } else {
      append(item, `${item.failed ? "Failed" : "Tool"}: ${item.toolName ?? "tool"}`, true);
      append(item, expandTools ? item.text : toolResultSummary(item) ?? truncate(item.text, 160));
    }
  }
  return lines;
}
