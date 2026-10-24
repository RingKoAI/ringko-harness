import stringWidth from "string-width";
import { cleanTerminalText } from "./editor.ts";

/** Keep shortcut labels intact instead of clipping a key combination in half. */
export function hintLine(hints: readonly string[], columns: number): string {
  let line = "";
  for (const hint of hints) {
    const label = cleanTerminalText(hint).replace(/\s+/g, " ").trim();
    const next = line ? `${line} · ${label}` : label;
    if (stringWidth(next) <= columns) line = next;
  }
  return line;
}
