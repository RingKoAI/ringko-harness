import type { Key } from "ink";

export type Shortcut = "model" | "nextModel" | "previousModel" | "effort" | "tools" | "thinking" | "copy" | "sessions" | "agents" | "pageUp" | "pageDown";
/** Pi defaults. Alt+P is the portable Windows reverse-model shortcut. */
export function shortcut(input: string, key: Pick<Key, "ctrl" | "meta" | "shift" | "tab" | "pageUp" | "pageDown">): Shortcut | undefined {
  if (key.tab && key.shift) return "effort";
  if (key.pageUp) return "pageUp";
  if (key.pageDown) return "pageDown";
  if (input === "p" && key.meta) return "previousModel";
  if (!key.ctrl) return undefined;
  if (input === "p") return key.shift ? "previousModel" : "nextModel";
  return ({ l: "model", o: "tools", t: "thinking", x: "copy", r: "sessions", g: "agents" } as const)[input as "l" | "o" | "t" | "x" | "r" | "g"];
}

export const SHORTCUT_HELP = "Ctrl+L model · Ctrl+P next · Alt+P previous · Shift+Tab effort\nCtrl+O tools · Ctrl+T thinking · Ctrl+X copy last answer\nCtrl+R sessions · Ctrl+G Main/Subagent · PgUp/PgDn history\nEsc interrupt · Up/Down input history · Shift+Enter or Alt+Enter newline\nCtrl+A/E line start/end · Ctrl+U/K delete line · Ctrl+W delete word\nCtrl+C clear input / interrupt · Ctrl+D exit only when input is empty";
