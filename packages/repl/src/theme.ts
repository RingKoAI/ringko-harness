// Semantic theme tokens for the RingKo REPL.
export const theme = {
  brand: "#ff7a1a",
  userBackground: "#303030",
  tool: "cyan",
  error: "red",
  success: "green",
  dim: "gray",
  border: "gray",
  permission: "yellow",
  assistant: undefined,
} as const;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
