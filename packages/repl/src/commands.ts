// Slash-command registry and input parsing for the REPL (pure, unit-testable).
import { discoverSkills, loadMcpServers } from "@ringko-ai/config";
import { SHORTCUT_HELP } from "./keybindings.ts";

export type ParsedInput =
  | { kind: "prompt"; value: string }
  | { kind: "command"; name: string; arg: string }
  | { kind: "unknown"; name: string };

export interface SlashContext {
  /** Append a notice line to the transcript. */
  print(text: string): void;
  clear(): void;
  newSession?(): void;
  exit(): void;
  modelLabel: string;
  workspace: string;
  sessionId?: string;
  toolNames(): string[];
  /** Connect to / list providers. */
  connect(arg: string): void | Promise<void>;
  /** Sign in to a provider via OAuth (default: openai). */
  login(provider: string): void | Promise<void>;
  /** Select the active model; no argument opens the model selector. */
  pickModel(arg: string): void | Promise<void>;
  /** Open the session picker (resume). */
  pickSession(): void | Promise<void>;
  /** Set the reasoning depth (effort); no argument opens a selector. */
  pickThinking(arg: string): void | Promise<void>;
  /** Toggle whether model reasoning is shown (arg: on|off). */
  toggleThinking(arg: string): void | Promise<void>;
  /** Compact the running context into a summary (optional focus text). */
  compact(arg: string): void | Promise<void>;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  run(ctx: SlashContext, arg: string): void;
}

export function buildCommands(): SlashCommand[] {
  return [
    { name: "help", aliases: ["?"], description: "show this help", run: (ctx) => ctx.print(helpText()) },
    { name: "shortcuts", aliases: ["keys"], description: "show keyboard shortcuts", run: ctx => ctx.print(SHORTCUT_HELP) },
    { name: "clear", description: "clear the transcript", run: (ctx) => ctx.clear() },
    { name: "new", description: "start a new session", run: ctx => ctx.newSession?.() },
    { name: "exit", aliases: ["quit", "q"], description: "quit the REPL", run: (ctx) => ctx.exit() },
    {
      name: "connect",
      description: "add a provider from presets, or switch provider",
      run: (ctx, arg) => {
        void ctx.connect(arg);
      },
    },
    {
      name: "login",
      description: "sign in with OAuth (openai | github-copilot | xai | anthropic)",
      run: (ctx, arg) => {
        void ctx.login(arg);
      },
    },
    {
      name: "resume",
      description: "resume a previous session",
      run: (ctx) => {
        void ctx.pickSession();
      },
    },
    {
      name: "effort",
      description: "set the reasoning depth (off|low|high|max)",
      run: (ctx, arg) => {
        void ctx.pickThinking(arg);
      },
    },
    {
      name: "compact",
      description: "compact the context into a summary",
      run: (ctx, arg) => {
        void ctx.compact(arg);
      },
    },
    {
      name: "thinking",
      description: "toggle showing model reasoning (on|off)",
      run: (ctx, arg) => {
        void ctx.toggleThinking(arg);
      },
    },
    {
      name: "model",
      description: "select the active model",
      run: (ctx, arg) => {
        void ctx.pickModel(arg);
      },
    },
    { name: "workspace", description: "show the workspace root", run: (ctx) => ctx.print(ctx.workspace) },
    {
      name: "session",
      description: "show the current session id",
      run: (ctx) => ctx.print(ctx.sessionId ?? "(no session)"),
    },
    {
      name: "tools",
      description: "list registered tools",
      run: (ctx) => ctx.print(ctx.toolNames().join(", ") || "(no tools)"),
    },
    {
      name: "skills",
      description: "list installed skills",
      run: (ctx) => {
        const skills = discoverSkills();
        ctx.print(skills.length ? skills.map((skill) => `${skill.name} (${skill.source})`).join(", ") : "(no skills)");
      },
    },
    {
      name: "mcp",
      description: "list configured MCP servers",
      run: (ctx) => {
        try {
          const servers = loadMcpServers();
          ctx.print(servers.length ? servers.map((server) => server.name).join(", ") : "(no MCP servers)");
        } catch (error) {
          ctx.print((error as Error).message);
        }
      },
    },
  ];
}

const COMMANDS = buildCommands();

export function commandGroup(name: string): string {
  if (["new", "resume", "session", "clear", "compact"].includes(name)) return "Session";
  if (["connect", "login", "model", "effort", "thinking"].includes(name)) return "Model & providers";
  if (["workspace", "tools", "skills", "mcp"].includes(name)) return "Workspace";
  return "Help & application";
}

export function findCommand(name: string): SlashCommand | undefined {
  const lower = name.toLowerCase();
  return COMMANDS.find((command) => command.name === lower || command.aliases?.includes(lower));
}

export function listCommands(): readonly SlashCommand[] {
  return COMMANDS;
}

/** Commands whose name/alias/description matches `query` (no leading slash). */
export function filterCommands(query: string): SlashCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [...COMMANDS];
  const prefix: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const command of COMMANDS) {
    const names = [command.name, ...(command.aliases ?? [])];
    if (names.some((name) => name.startsWith(trimmed))) prefix.push(command);
    else if (command.description.toLowerCase().includes(trimmed)) contains.push(command);
  }
  return [...prefix, ...contains];
}

export function parseInput(input: string): ParsedInput {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { kind: "prompt", value: input };
  const rest = trimmed.slice(1);
  const space = rest.search(/\s/);
  const name = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const arg = space === -1 ? "" : rest.slice(space + 1).trim();
  if (name.length === 0) return { kind: "prompt", value: input };
  return findCommand(name) ? { kind: "command", name, arg } : { kind: "unknown", name };
}

export function helpText(): string {
  const lines = ["Commands:"];
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  for (const command of COMMANDS) {
    const names = [command.name, ...(command.aliases ?? [])].join(", ");
    lines.push(`  /${names.padEnd(width + 4)} ${command.description}`);
  }
  lines.push("", "Type a message to run the agent; risky tools ask for approval (y/n).");
  return lines.join("\n");
}
