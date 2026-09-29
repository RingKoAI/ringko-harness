import { describe, expect, it } from "bun:test";
import { filterCommands, findCommand, parseInput } from "../src/commands.ts";

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
});
