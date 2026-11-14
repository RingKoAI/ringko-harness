import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "@ringko-ai/app";
import { attachFrontend, BackendClient } from "@ringko-ai/client";
import { sharedPort } from "../src/backend.ts";
import { webCommand } from "../src/cli/commands/web.ts";
import type { ParsedArgs } from "../src/cli/types.ts";

it("reuses the CLI-started shared backend instead of starting another one", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-web-reuse-"));
  const previousHome = process.env.RINGKO_HOME;
  const previousServer = process.env.RINGKO_SERVER;
  process.env.RINGKO_HOME = join(root, "home");
  delete process.env.RINGKO_SERVER;
  const app = startServer({ workspace: root, port: sharedPort(root), managed: true });
  const out: string[] = [];
  const err: string[] = [];
  const parsed: ParsedArgs = { command: "web", positionals: [], workspace: root };
  const signal = new AbortController(), ready = Promise.withResolvers<void>();
  const client = new BackendClient({ url: app.url, workspace: root });
  const cli = await attachFrontend(client, "cli");
  try {
    const running = webCommand(parsed, { out: line => { out.push(line); if (line.includes("Keep this Web frontend")) ready.resolve(); }, err: line => err.push(line) }, { signal: signal.signal });
    await ready.promise;
    expect((await client.identity()).lifecycle).toMatchObject({ cli: 1, web: 1 });
    await cli.close(); expect((await client.identity()).lifecycle?.web).toBe(1);
    signal.abort(); expect(await running).toBe(0);
    expect(out.join("\n")).toContain(app.url);
    expect(err).toEqual([]);
  } finally {
    signal.abort(); await cli.close(); await app.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousServer === undefined) delete process.env.RINGKO_SERVER; else process.env.RINGKO_SERVER = previousServer;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
