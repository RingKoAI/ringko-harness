import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "@ringko-ai/app";
import { sharedPort } from "../src/backend.ts";
import { serveCommand } from "../src/cli/commands/serve.ts";
import type { ParsedArgs } from "../src/cli/types.ts";

it("reuses the CLI-started shared backend instead of starting another one", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-serve-reuse-"));
  const previousHome = process.env.RINGKO_HOME;
  const previousServer = process.env.RINGKO_SERVER;
  process.env.RINGKO_HOME = join(root, "home");
  delete process.env.RINGKO_SERVER;
  const app = startServer({ workspace: root, port: sharedPort(root), shared: true });
  const out: string[] = [];
  const err: string[] = [];
  const parsed: ParsedArgs = { command: "serve", positionals: [], workspace: root };
  try {
    expect(await serveCommand(parsed, { out: line => out.push(line), err: line => err.push(line) })).toBe(0);
    expect(out.join("\n")).toContain("Already running");
    expect(out.join("\n")).toContain(app.url);
    expect(err).toEqual([]);
  } finally {
    app.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousServer === undefined) delete process.env.RINGKO_SERVER; else process.env.RINGKO_SERVER = previousServer;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
