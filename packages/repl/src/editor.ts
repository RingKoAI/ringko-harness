import stringWidth from "string-width";

export const INPUT_LIMIT = 65_536;
export const HISTORY_LIMIT = 100;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), part => part.segment);
}
/** Untrusted input must not execute terminal control sequences. */
export function cleanTerminalText(text: string): string {
  // Control-byte patterns are intentional: remove OSC/CSI and C0/C1 injection.
  /* eslint-disable no-control-regex */
  return text.replace(/\r\n?/g, "\n")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  /* eslint-enable no-control-regex */
}
export interface EditorState { text: string; cursor: number }
export type EditorAction =
  | { type: "insert" | "replace"; text: string }
  | { type: "left" | "right" | "up" | "down" | "home" | "end" | "backspace" | "delete" | "clear" | "killStart" | "killEnd" | "killWord" };
/** Cursor positions count grapheme clusters rather than UTF-16 code units. */
export function edit(state: EditorState, action: EditorAction): EditorState {
  const chars = graphemes(state.text);
  const cursor = Math.max(0, Math.min(state.cursor, chars.length));
  if (action.type === "replace") {
    return edit({ text: "", cursor: 0 }, { type: "insert", text: action.text });
  }
  if (action.type === "clear") return { text: "", cursor: 0 };
  if (action.type === "left") return { text: state.text, cursor: Math.max(0, cursor - 1) };
  if (action.type === "right") return { text: state.text, cursor: Math.min(chars.length, cursor + 1) };
  const lineStart = cursor === 0 ? 0 : chars.lastIndexOf("\n", cursor - 1) + 1;
  const newline = chars.indexOf("\n", cursor);
  const lineEnd = newline < 0 ? chars.length : newline;
  if (action.type === "up") {
    const previousStart = lineStart <= 1 ? 0 : chars.lastIndexOf("\n", lineStart - 2) + 1;
    return { text: state.text, cursor: lineStart === 0 ? cursor : Math.min(lineStart - 1, previousStart + cursor - lineStart) };
  }
  if (action.type === "down") {
    const nextEnd = chars.indexOf("\n", lineEnd + 1);
    return { text: state.text, cursor: lineEnd === chars.length ? cursor : Math.min(nextEnd < 0 ? chars.length : nextEnd, lineEnd + 1 + cursor - lineStart) };
  }
  if (action.type === "home") return { text: state.text, cursor: lineStart };
  if (action.type === "end") return { text: state.text, cursor: lineEnd };
  if (action.type === "insert") {
    const incoming = graphemes(cleanTerminalText(action.text.slice(0, INPUT_LIMIT * 2)));
    let available = INPUT_LIMIT - state.text.length;
    const accepted: string[] = [];
    for (const char of incoming) { if (char.length > available) break; accepted.push(char); available -= char.length; }
    chars.splice(cursor, 0, ...accepted);
    return { text: chars.join(""), cursor: cursor + accepted.length };
  }
  let start = cursor;
  let end = cursor;
  if (action.type === "backspace") start = Math.max(0, cursor - 1);
  if (action.type === "delete") end = Math.min(chars.length, cursor + 1);
  if (action.type === "killStart") start = lineStart;
  if (action.type === "killEnd") end = lineEnd;
  if (action.type === "killWord") {
    while (start > 0 && /\s/.test(chars[start - 1] ?? "")) start--;
    while (start > 0 && !/\s/.test(chars[start - 1] ?? "")) start--;
  }
  chars.splice(start, end - start);
  return { text: chars.join(""), cursor: start };
}

export interface EditorLine { before: string; cursor?: string; after: string }
/** Bound the visible editor by terminal cells, while keeping the complete draft. */
export function editorLines(state: EditorState, columns: number, maxRows: number): EditorLine[] {
  const width = Math.max(2, columns);
  const rows: EditorLine[] = [{ before: "", after: "" }];
  let row = 0;
  let used = 0;
  let cursorRow = 0;
  const chars = graphemes(state.text);
  for (let index = 0; index <= chars.length; index++) {
    const char = chars[index] ?? " ";
    const cells = char === "\n" ? 1 : stringWidth(char);
    if (used + cells > width) { row++; rows.push({ before: "", after: "" }); used = 0; }
    if (index === state.cursor) { rows[row].cursor = char === "\n" ? " " : char; cursorRow = row; }
    else if (index < state.cursor) rows[row].before += char === "\n" ? "" : char;
    else if (index < chars.length) rows[row].after += char === "\n" ? "" : char;
    if (char === "\n") { row++; rows.push({ before: "", after: "" }); used = 0; }
    else used += cells;
  }
  const start = Math.max(0, cursorRow - Math.max(1, maxRows) + 1);
  return rows.slice(start, start + Math.max(1, maxRows));
}
