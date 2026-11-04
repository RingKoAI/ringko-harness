// Shared status glyphs for the task/todo tree surfaces.
// Status markers stay ASCII: terminals may render symbol characters as emoji,
// and terminal output is also written to diagnostic logs.
export const GLYPH = {
  pointer: ">",
  bulletOn: "●",
  bulletOff: "○",
  running: "[*]",
  paused: "[ ]",
  tick: "[x]",
  failed: "[!]",
  cancelled: "[-]",
  squareOn: "[*]",
  squareOff: "[ ]",
  ellipsis: "…",
  tee: "├─",
  last: "└─",
} as const;
