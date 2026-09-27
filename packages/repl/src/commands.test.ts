import { describe, expect, it } from "bun:test";
import { parseCommand } from "./commands.ts";

describe("parseCommand", () => {
  it("treats plain text as a prompt", () => {
    expect(parseCommand("hello world")).toEqual({ kind: "prompt", value: "hello world" });
  });

  it("parses control commands", () => {
    expect(parseCommand("/exit")).toEqual({ kind: "exit" });
    expect(parseCommand("/quit")).toEqual({ kind: "exit" });
    expect(parseCommand("/help")).toEqual({ kind: "help" });
    expect(parseCommand("/clear")).toEqual({ kind: "clear" });
    expect(parseCommand("/bogus")).toEqual({ kind: "unknown", name: "bogus" });
  });

  it("keeps a bare slash as a prompt", () => {
    expect(parseCommand("/ ")).toEqual({ kind: "prompt", value: "/ " });
  });
});
