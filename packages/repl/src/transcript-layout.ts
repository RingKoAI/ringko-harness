import wrapAnsi from "wrap-ansi";
import { cleanTerminalText } from "./editor.ts";
import { markdownToAnsi } from "./markdown.ts";
import { toolCallSummary, toolInputText, toolOutputText, toolResultSummary, type ReplItem } from "./state.ts";

export interface TranscriptLine { text: string; kind: ReplItem["kind"]; failed?: boolean; heading?: boolean }
/** Wrap by terminal cell width (including CJK), rather than code-unit length. */
export function transcriptLines(items: readonly ReplItem[], columns: number, expandThinking: boolean, expandTools: boolean): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const width = Math.max(1, columns);
  const append = (item: ReplItem, text: string, heading = false) => {
    for (const line of wrapAnsi(cleanTerminalText(text), width, { hard: true, trim: false }).split("\n"))
      lines.push({ text: line, kind: item.kind, failed: item.failed, heading });
  };
  // Assistant output is Markdown: sanitize the raw text, then lower it to ANSI
  // and wrap by cell width so the SGR codes survive the line split.
  const appendMarkdown = (item: ReplItem, text: string) => {
    const rendered = markdownToAnsi(text);
    for (const line of wrapAnsi(rendered, width, { hard: true, trim: false }).split("\n"))
      lines.push({ text: line, kind: item.kind, failed: item.failed });
  };
  for (const item of items) {
    if (item.kind === "user") { append(item, ""); append(item, `> ${item.text}`); }
    else if (item.kind === "assistant") appendMarkdown(item, item.text);
    else if (item.kind === "notice") append(item, item.text);
    else if (item.kind === "thinking") {
      append(item, expandThinking ? "Thinking" : "Thinking (Ctrl+T to expand)", true);
      if (expandThinking) append(item, item.text);
    } else {
      append(item, "");
      const target = toolCallSummary(item);
      append(item, `${item.running ? "Running" : item.incomplete ? "Unknown" : item.failed ? "Failed" : "Completed"}: ${item.toolName ?? "tool"}${target ? ` (${target})` : ""}`, true);
      append(item, `  ${toolResultSummary(item) ?? "Done"} · Ctrl+O ${expandTools ? "collapse" : "expand"}`);
      if (expandTools) {
        const detailWidth = Math.max(1, width - 2);
        const input = toolInputText(item);
        if (input !== undefined) {
          append(item, "  Input:");
          for (const line of wrapAnsi(cleanTerminalText(input), detailWidth, { hard: true, trim: false }).split("\n")) append(item, `  ${line}`);
        }
        if (!item.running) {
          append(item, "  Output:");
          for (const line of wrapAnsi(cleanTerminalText(toolOutputText(item)), detailWidth, { hard: true, trim: false }).split("\n")) append(item, `  ${line}`);
        }
      }
      append(item, "");
    }
  }
  return lines;
}
