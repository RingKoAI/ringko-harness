import { afterEach, describe, expect, it } from "bun:test";
import type { LoadedPlugin } from "@ringko-ai/config";
import {
  buildPluginCommands,
  commandGroup,
  filterCommands,
  findCommand,
  parseInput,
  resetPluginCommands,
  setPluginCommands,
  type SlashContext,
} from "../src/commands.ts";

describe("parseInput", () => {
  it("routes leading bang commands without changing interior exclamation marks", () => {
    expect(parseInput(" !git status ")).toEqual({ kind: "shell", value: "git status" });
    expect(parseInput("!")).toEqual({ kind: "shell", value: "" });
    expect(parseInput("hello!")).toEqual({ kind: "prompt", value: "hello!" });
  });
  it("treats plain text as a prompt", () => {
    expect(parseInput("hello world")).toEqual({ kind: "prompt", value: "hello world" });
  });

  it("parses known commands and their arguments", () => {
    expect(parseInput("/help")).toEqual({ kind: "command", name: "help", arg: "" });
    expect(parseInput("/quit")).toEqual({ kind: "command", name: "quit", arg: "" });
    expect(parseInput("/model gpt-4o")).toEqual({ kind: "command", name: "model", arg: "gpt-4o" });
  });

  it("flags unknown commands", () => {
    expect(parseInput("/bogus")).toEqual({ kind: "unknown", name: "bogus" });
  });

  it("keeps a bare slash as a prompt", () => {
    expect(parseInput("/ ")).toEqual({ kind: "prompt", value: "/ " });
  });
});

describe("registry", () => {
  it("resolves aliases", () => {
    expect(findCommand("q")?.name).toBe("exit");
    expect(findCommand("?")?.name).toBe("help");
    expect(findCommand("nope")).toBeUndefined();
  });

  it("filters by name prefix, then description", () => {
    const names = filterCommands("m").map((command) => command.name);
    expect(names).toContain("model");
    expect(names).toContain("mcp");
  });

  it("lists everything for an empty query", () => {
    expect(filterCommands("").length).toBeGreaterThan(5);
  });

  it("routes skills and MCP to their pickers when a host provides them", () => {
    let skills = 0;
    let mcp = 0;
    const ctx = { pickSkills: () => { skills += 1; }, pickMcp: () => { mcp += 1; }, print: () => {}, workspace: "/work" } as unknown as SlashContext;
    findCommand("skills")!.run(ctx, "");
    findCommand("mcp")!.run(ctx, "");
    expect(skills).toBe(1);
    expect(mcp).toBe(1);
  });
});

describe("plugin commands", () => {
  afterEach(() => resetPluginCommands());

  const plugin: LoadedPlugin = {
    id: "reviewer",
    dir: "/plugins/reviewer",
    manifest: { name: "reviewer" },
    commands: [{ name: "review", description: "Review code", prompt: "Review $ARGUMENTS" }],
    mcpServers: {},
    skillDirs: [],
    source: "ringko",
    scope: "global",
  };

  it("registers prompt templates and expands their arguments", () => {
    setPluginCommands(buildPluginCommands([plugin]));
    expect(parseInput("/review src/a.ts")).toEqual({ kind: "command", name: "review", arg: "src/a.ts" });
    expect(commandGroup("review")).toBe("Plugins");
    const sent: string[] = [];
    const ctx = { print: () => {}, workspace: "/work", sendPrompt: (text: string) => { sent.push(text); } } as unknown as SlashContext;
    findCommand("review")!.run(ctx, "src/a.ts");
    expect(sent).toEqual(["Review src/a.ts"]);
  });

  it("never shadows built-in commands", () => {
    setPluginCommands(buildPluginCommands([{ ...plugin, commands: [{ name: "help", prompt: "hijack" }] }]));
    expect(findCommand("help")!.description).toContain("show this help");
    expect(parseInput("/help")).toEqual({ kind: "command", name: "help", arg: "" });
  });

  it("reports when the host cannot submit a prompt", () => {
    setPluginCommands(buildPluginCommands([plugin]));
    const printed: string[] = [];
    const ctx = { print: (text: string) => { printed.push(text); }, workspace: "/work" } as unknown as SlashContext;
    findCommand("review")!.run(ctx, "src/a.ts");
    expect(printed[0]).toContain("interactive REPL");
  });
});
