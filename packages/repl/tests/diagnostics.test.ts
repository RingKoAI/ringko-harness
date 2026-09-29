import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnosticLogPath, writeDiagnostic } from "@ringko-ai/config";
import { isolateTerminalDiagnostics } from "../src/diagnostics.ts";

it("isolates console and direct stderr, preserves callbacks and restores methods", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ringko-diagnostics-"));
  const home = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = directory;
  const originalWrite = process.stderr.write;
  const originalWarn = console.warn;
  const restore = isolateTerminalDiagnostics();
  let called = false;
  try {
    console.warn("SDK warning %s", "example");
    console.assert(true, "should not be logged");
    console.assert(false, "assertion failed");
    process.stderr.write("direct diagnostic", () => { called = true; });
    await Promise.resolve();
    const log = readFileSync(diagnosticLogPath(), "utf8");
    expect(log).toContain("SDK warning example");
    expect(log).toContain("direct diagnostic");
    expect(log).toContain("assertion failed");
    expect(log).not.toContain("should not be logged");
    expect(called).toBe(true);
  } finally {
    restore();
    if (home === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = home;
    rmSync(directory, { recursive: true, force: true });
  }
  expect(process.stderr.write).toBe(originalWrite);
  expect(console.warn).toBe(originalWarn);
});

it("bounds and rotates diagnostic files and redacts common credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "ringko-diagnostics-"));
  const home = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = directory;
  try {
    expect(writeDiagnostic("test", "Bearer sensitive-token api_key=private-value")).toBe(true);
    const path = diagnosticLogPath();
    const first = readFileSync(path, "utf8");
    expect(first).not.toContain("sensitive-token");
    expect(first).not.toContain("private-value");
    writeFileSync(path, "x".repeat(4 * 1024 * 1024));
    expect(writeDiagnostic("test", "y".repeat(32 * 1024))).toBe(true);
    expect(readFileSync(`${path}.previous`, "utf8").length).toBe(4 * 1024 * 1024);
    expect(JSON.parse(readFileSync(path, "utf8")).message.length).toBe(16 * 1024);
    expect(JSON.parse(readFileSync(path, "utf8")).truncated).toBe(true);
  } finally {
    if (home === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = home;
    rmSync(directory, { recursive: true, force: true });
  }
});
