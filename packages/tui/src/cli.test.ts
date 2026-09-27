import { describe, expect, it } from "bun:test";
import { VERSION, runCli, type CliIo } from "./cli.ts";

function collect(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

describe("ringko cli", () => {
  it("prints the version", async () => {
    const { io, out } = collect();
    expect(await runCli(["version"], io)).toBe(0);
    expect(out).toEqual([`ringko ${VERSION}`]);
  });

  it("shows help when no command is given", async () => {
    const { io, out } = collect();
    expect(await runCli([], io)).toBe(0);
    expect(out.join("\n")).toContain("Usage:");
  });

  it("reports the access mode", async () => {
    const { io, out } = collect();
    expect(await runCli(["info"], io)).toBe(0);
    expect(out[0]).toContain("approval");
  });

  it("lists the registered workspace tools", async () => {
    const { io, out } = collect();
    expect(await runCli(["tools"], io)).toBe(0);
    expect(out).toContain("read_file");
    expect(out).toContain("write_file");
    expect(out).toContain("list_dir");
  });

  it("runs the offline echo provider", async () => {
    const { io, out } = collect();
    expect(await runCli(["run", "hello", "world"], io)).toBe(0);
    expect(out).toEqual(["echo: hello world"]);
  });

  it("requires a prompt for run", async () => {
    const { io, err } = collect();
    expect(await runCli(["run"], io)).toBe(1);
    expect(err.join("\n")).toContain("requires a prompt");
  });

  it("rejects unknown commands and providers", async () => {
    const unknownCommand = collect();
    expect(await runCli(["bogus"], unknownCommand.io)).toBe(1);
    expect(unknownCommand.err.join("\n")).toContain("Unknown command");

    const unknownProvider = collect();
    expect(await runCli(["run", "x", "--provider", "nope"], unknownProvider.io)).toBe(1);
    expect(unknownProvider.err.join("\n")).toContain('Unknown provider "nope"');
  });
});
