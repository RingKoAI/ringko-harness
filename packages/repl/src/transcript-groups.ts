import { transcriptTurns, toolActivityKind, type ToolActivityKind, type TranscriptRunStatus } from "@ringko-ai/client";
import type { ReplItem } from "./state.ts";

export interface TranscriptGroup {
  items: readonly ReplItem[];
  tools: readonly ReplItem[];
  foldable: boolean;
  running: boolean;
}
export interface TranscriptRunView { busy?: boolean; runStatus?: TranscriptRunStatus }

/** Render-only user turns; full expanded calls remain in their original message order. */
export function transcriptGroups(items: readonly ReplItem[], view: TranscriptRunView = {}): TranscriptGroup[] {
  const turns = transcriptTurns(items.map(item => ({ role: item.kind, runStart: item.runStart, runStatus: item.runStatus })));
  return turns.map((turn, ordinal) => {
    const members = items.slice(turn.start, turn.end), tools = members.filter(item => item.kind === "tool");
    const status = turn.status ?? (ordinal === turns.length - 1 ? view.runStatus : undefined);
    const running = members.some(item => item.running) || status === "running" || (status === undefined && view.busy === true && ordinal === turns.length - 1);
    const lastTool = members.findLastIndex(item => item.kind === "tool");
    const answer = members.findLastIndex(item => item.kind === "assistant" && !item.hasToolCalls && !item.failed && item.text.trim().length > 0);
    const complete = status === "completed" || (status === undefined && answer > lastTool);
    return { items: members, tools, running,
      foldable: tools.length > 0 && !running && complete && !members.some(item => item.failed || item.incomplete || item.unmatched || item.running)
        && (turn.userIndex !== undefined || turn.runStart !== undefined || view.runStatus !== undefined) };
  });
}

export function turnToolsLabel(group: TranscriptGroup): string {
  const names = new Map<ToolActivityKind, number>();
  for (const item of group.tools) { const name = toolActivityKind(item.toolName ?? "tool"); names.set(name, (names.get(name) ?? 0) + 1); }
  return `Turn tools · ${group.tools.length} call${group.tools.length === 1 ? "" : "s"} · ${[...names].map(([name, count]) => `${name} ${count}`).join(" · ")}${group.running ? " · Running" : ""}`;
}
