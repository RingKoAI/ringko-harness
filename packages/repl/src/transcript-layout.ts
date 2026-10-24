import wrapAnsi from "wrap-ansi";
import { cleanTerminalText } from "./editor.ts";
import { markdownToAnsi, MARKDOWN_LIMITS } from "./markdown.ts";
import { toolCallSummary, toolInputText, toolOutputText, toolResultSummary, type ReplItem } from "./state.ts";
import { explorationLabel, transcriptGroups } from "./transcript-groups.ts";

export interface TranscriptLine {
  text: string;
  kind: ReplItem["kind"];
  failed?: boolean;
  heading?: boolean;
  running?: boolean;
  itemId: number;
  /** Position in rendered message text, independent of the current terminal width. */
  position: number;
}

export const TRANSCRIPT_LIMITS = Object.freeze({ cacheEntries: 256, cacheCharacters: 2_097_152, toolPreview: 65_536 });
type BlockRenderer = (item: ReplItem, columns: number, thinking: boolean, tools: boolean) => TranscriptLine[];

function wrapped(item: ReplItem, text: string, columns: number, options: { heading?: boolean; markdown?: boolean; prefix?: string; continuation?: string; section?: number } = {}): TranscriptLine[] {
  const prefix = options.prefix ?? "";
  const continuation = options.continuation ?? prefix;
  const width = Math.max(1, columns - prefix.length);
  const source = options.markdown ? markdownToAnsi(text) : cleanTerminalText(text);
  let position = (options.section ?? 0) * (MARKDOWN_LIMITS.characters + 1);
  return wrapAnsi(source, width, { hard: true, trim: false }).split("\n").map((line, index) => {
    const result = { text: `${index === 0 ? prefix : continuation}${line}`, kind: item.kind, failed: item.failed, heading: options.heading, running: item.running, itemId: item.id, position };
    position += Math.max(1, cleanTerminalText(line).length);
    return result;
  });
}

function renderBlock(item: ReplItem, columns: number, thinking: boolean, tools: boolean): TranscriptLine[] {
  if (item.kind === "user") return wrapped(item, item.text.slice(0, MARKDOWN_LIMITS.characters) + (item.text.length > MARKDOWN_LIMITS.characters ? "\n[Prompt display truncated; full text retained in session]" : ""), columns, { prefix: "> ", continuation: "  " });
  if (item.kind === "assistant") return wrapped(item, item.text, columns, { markdown: true, prefix: "● ", continuation: "  " });
  if (item.kind === "notice") return wrapped(item, item.text, columns, { prefix: "  " });
  if (item.kind === "thinking") {
    const title = wrapped(item, thinking ? "Thinking" : "Thinking · Ctrl+T to expand", columns, { prefix: "  ", heading: true });
    return thinking ? [...title, ...wrapped(item, item.text.slice(0, MARKDOWN_LIMITS.characters), columns, { prefix: "  ", section: 1 })] : title;
  }
  const target = toolCallSummary(item);
  const status = item.failed ? " · Failed" : item.incomplete ? " · Outcome unknown" : item.running ? " · Running" : "";
  const lines = wrapped(item, `${item.toolName ?? "tool"}${target ? ` (${target})` : ""}${status}`, columns, { prefix: "● ", continuation: "  ", heading: true });
  lines.push(...wrapped(item, toolResultSummary(item) ?? "Done", columns, { prefix: "  └ ", continuation: "    ", section: 1 }));
  if (tools) {
    const input = toolInputText(item);
    if (input !== undefined) lines.push(...wrapped(item, `Input:\n${input}`, columns, { prefix: "  ", section: 2 }));
    if (!item.running) {
      const output = toolOutputText(item);
      const preview = output.slice(0, TRANSCRIPT_LIMITS.toolPreview);
      lines.push(...wrapped(item, `Output:\n${preview}${output.length > preview.length ? "\n[Display preview truncated; full output retained in session]" : ""}`, columns, { prefix: "  ", section: 3 }));
    }
  }
  return lines;
}

function layout(items: readonly ReplItem[], columns: number, thinking: boolean, tools: boolean, render: BlockRenderer): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const width = Math.max(1, Math.floor(columns));
  for (const group of transcriptGroups(items)) {
    const first = group.items[0];
    if (!first) continue;
    if (lines.length && (first.kind === "user" || first.kind === "tool" || first.kind === "assistant")) {
      lines.push({ text: "", kind: "notice", itemId: first.id, position: -1 });
    }
    if (group.exploration && group.items.length > 1 && !tools) {
      const active = group.items.find(item => item.running);
      const last = active ?? group.items.at(-1)!;
      lines.push(...wrapped({ ...first, running: Boolean(active) }, explorationLabel(group.items), width, { prefix: "● ", heading: true }));
      lines.push(...wrapped(first, `${last.toolName}${toolCallSummary(last) ? ` (${toolCallSummary(last)})` : ""} · ${toolResultSummary(last) ?? "Done"}`, width, { prefix: "  └ ", continuation: "    ", section: 1 }));
    } else {
      for (const item of group.items) lines.push(...render(item, width, thinking, tools));
    }
  }
  return lines;
}

/** Pure entry point for consumers that do not retain a render cache. */
export function transcriptLines(items: readonly ReplItem[], columns: number, thinking: boolean, tools: boolean): TranscriptLine[] {
  return layout(items, columns, thinking, tools, renderBlock);
}

/** Per-view bounded cache: completed blocks survive unrelated stream updates. */
export function createTranscriptRenderer() {
  const cache = new Map<number, { signature: readonly unknown[]; lines: TranscriptLine[]; size: number }>();
  let characters = 0;
  const render: BlockRenderer = (item, columns, thinking, tools) => {
    const signature = [item.kind, item.text, item.toolName, item.running, item.incomplete, item.failed, toolCallSummary(item), tools ? toolInputText(item) : undefined, columns, thinking, tools];
    const previous = cache.get(item.id);
    if (previous && previous.signature.every((part, index) => part === signature[index])) {
      cache.delete(item.id);
      cache.set(item.id, previous);
      return previous.lines;
    }
    if (previous) { characters -= previous.size; cache.delete(item.id); }
    const lines = renderBlock(item, columns, thinking, tools);
    const size = signature.reduce<number>((sum, part) => sum + (typeof part === "string" ? part.length : 0), 0) + lines.reduce((sum, line) => sum + line.text.length, 0);
    if (size <= TRANSCRIPT_LIMITS.cacheCharacters) {
      cache.set(item.id, { signature, lines, size });
      characters += size;
      while (cache.size > TRANSCRIPT_LIMITS.cacheEntries || characters > TRANSCRIPT_LIMITS.cacheCharacters) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        characters -= cache.get(oldest)!.size;
        cache.delete(oldest);
      }
    }
    return lines;
  };
  return (items: readonly ReplItem[], columns: number, thinking: boolean, tools: boolean) => layout(items, columns, thinking, tools, render);
}
