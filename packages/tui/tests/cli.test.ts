import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION, runCli, type CliIo } from "../src/cli.ts";

function collect(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-cli-home-"));
  previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.RINGKO_HOME;
  else process.env.RINGKO_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

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
    expect(out).toContain("read");
    expect(out).toContain("write");
    expect(out).toContain("grep");
  });

  it("runs the offline echo provider when none is configured", async () => {
    const { io, out } = collect();
    expect(await runCli(["run", "hello", "world"], io)).toBe(0);
    expect(out).toEqual(["echo: hello world"]);
  });

  it("requires a prompt for run", async () => {
    const { io, err } = collect();
    expect(await runCli(["run"], io)).toBe(1);
    expect(err.join("\n")).toContain("requires a prompt");
  });

  it("rejects an unknown command", async () => {
    const { io, err } = collect();
    expect(await runCli(["bogus"], io)).toBe(1);
    expect(err.join("\n")).toContain("Unknown command");
  });

  it("reports an unknown provider from the configured module", async () => {
    const { io, err } = collect();
    expect(await runCli(["run", "x", "--provider", "nope", "--model", "m"], io)).toBe(1);
    expect(err.join("\n")).toContain('Unknown provider "nope"');
  });

  it("fails when an explicit config file is missing", async () => {
    const { io, err } = collect();
    expect(await runCli(["run", "x", "--config", "definitely-missing.json"], io)).toBe(2);
    expect(err.join("\n")).toContain("Cannot read config");
  });
});

describe("ringko config", () => {
  it("prints the config file paths", async () => {
    const { io, out } = collect();
    expect(await runCli(["config", "path"], io)).toBe(0);
    expect(out).toEqual([
      join(home, ".ringko", "settings.local.json"),
      join(home, ".ringko", "provider.json"),
    ]);
  });

  it("sets, gets, and unsets keys", async () => {
    const set = collect();
    expect(await runCli(["config", "set", "provider.name", "echo"], set.io)).toBe(0);

    const get = collect();
    expect(await runCli(["config", "get", "provider.name"], get.io)).toBe(0);
    expect(get.out[0]).toBe('"echo"');

    const unset = collect();
    expect(await runCli(["config", "unset", "provider.name"], unset.io)).toBe(0);

    const after = collect();
    expect(await runCli(["config", "get", "provider.name"], after.io)).toBe(0);
    expect(after.out[0]).toBe("");
  });
});
