import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { SubagentView } from "../subagent-view.ts";
import { fitTerminalLine } from "../editor.ts";
import { GLYPH } from "../glyphs.ts";
import { theme } from "../theme.ts";

/** Rows shown before the list collapses to a "+N older" summary. */
const MAX_VISIBLE = 6;

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

/** Main + delegated-task tree mirroring the reference terminal layout. */
export function TaskTree({ tasks, selectedId, columns }: { tasks: readonly SubagentView[]; selectedId?: string; columns: number }) {
  const anyRunning = tasks.some(task => task.status === "running");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);
  if (!tasks.length) return null;

  const selected = tasks.find(task => task.id === selectedId);
  const recent = tasks.slice(-MAX_VISIBLE);
  const visible = selected && !recent.includes(selected) ? [selected, ...tasks.slice(-(MAX_VISIBLE - 1))] : recent;
  const width = Math.max(1, columns - 2);
  const mainViewed = selectedId === undefined;

  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      <Text bold={mainViewed} color={mainViewed ? theme.brand : theme.dim}>
        {fitTerminalLine(`${mainViewed ? `${GLYPH.pointer} ` : "  "}${mainViewed ? GLYPH.bulletOn : GLYPH.bulletOff} main`, width)}
      </Text>
      {visible.map((task, index) => {
        const viewed = selectedId === task.id;
        const isRunning = task.status === "running";
        const color = task.status === "failed" || task.status === "cancelled" ? theme.error : viewed ? theme.brand : theme.dim;
        const elapsed = formatElapsed((task.endedAt ?? now) - task.startedAt);
        const tools = task.toolCount > 0 ? ` · ${task.toolCount} tool${task.toolCount === 1 ? "" : "s"}` : "";
        const suffix = `${isRunning ? GLYPH.running : GLYPH.paused} ${elapsed}${tools}`;
        return (
          <Text key={task.id} color={color} bold={viewed}>
            {fitTerminalLine(`${viewed ? `${GLYPH.pointer} ` : "  "}${index === visible.length - 1 ? GLYPH.last : GLYPH.tee} ${viewed ? GLYPH.bulletOn : GLYPH.bulletOff} ${task.description}  ${suffix}`, width)}
          </Text>
        );
      })}
      <Text color={theme.dim}>
        {fitTerminalLine(`Ctrl+G switch view · ${tasks.length} subagent${tasks.length === 1 ? "" : "s"}${tasks.length > visible.length ? ` · ${tasks.length - visible.length} older` : ""}`, width)}
      </Text>
    </Box>
  );
}
