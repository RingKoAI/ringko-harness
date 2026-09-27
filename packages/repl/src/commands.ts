// Slash-command parsing for the REPL (pure, unit-testable).

export type ParsedCommand =
  | { kind: "prompt"; value: string }
  | { kind: "exit" }
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "unknown"; name: string };

export const HELP_TEXT = [
  "Commands:",
  "  /help      show this help",
  "  /clear     clear the transcript",
  "  /exit      quit (also ctrl+c)",
  "",
  "Type a message to run the agent. Risky tool calls ask for approval (y/n).",
].join("\n");

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { kind: "prompt", value: input };
  const name = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  switch (name) {
    case "":
      return { kind: "prompt", value: input };
    case "exit":
    case "quit":
    case "q":
      return { kind: "exit" };
    case "help":
    case "?":
      return { kind: "help" };
    case "clear":
      return { kind: "clear" };
    default:
      return { kind: "unknown", name };
  }
}
