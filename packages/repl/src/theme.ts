// Semantic theme tokens for the RingKo REPL.
export const theme = {
  brand: "#e58c54",
  userBackground: "#303030",
  userText: "#eeeeee",
  tool: "#b8b8b8",
  selected: "#383838",
  shell: "magenta",
  error: "red",
  success: "green",
  dim: "gray",
  border: "gray",
  permission: "yellow",
  assistant: undefined,
} as const;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
