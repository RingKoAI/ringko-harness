import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "@ringko-ai/app";
import { readBackendRegistration, writeBackendRegistration } from "@ringko-ai/config";
import { connectBackend, findLiveBackend, sharedPort } from "../src/backend.ts";

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  if (!port) throw new Error("Could not allocate a test port.");
  return port;
}

it("reuses one automatically started backend for the same workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-shared-start-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  const previousServer = process.env.RINGKO_SERVER; delete process.env.RINGKO_SERVER;
  const previousToken = process.env.RINGKO_WEB_TOKEN; delete process.env.RINGKO_WEB_TOKEN;
  let app: ReturnType<typeof startServer> | undefined; let starts = 0;
  try {
    const start = (port: number) => { starts++; app = startServer({ workspace: root, shared: true, port }); };
    const first = await connectBackend({ workspace: root, start });
    const second = await connectBackend({ workspace: root, start });
    expect(starts).toBe(1); expect(first.url).toBe(second.url);
    expect((await first.client.identity()).instance).toBe((await second.client.identity()).instance);
    expect(sharedPort(root)).toBe(sharedPort(join(root, '.')));
    expect(sharedPort(root, join(root, 'one.json'))).not.toBe(sharedPort(root, join(root, 'two.json')));
  } finally {
    app?.stop(); if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousServer === undefined) delete process.env.RINGKO_SERVER; else process.env.RINGKO_SERVER = previousServer;
    if (previousToken === undefined) delete process.env.RINGKO_WEB_TOKEN; else process.env.RINGKO_WEB_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

it("discovers a manually served backend so TUI and Web share one instance", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-serve-discovery-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  const previousServer = process.env.RINGKO_SERVER; delete process.env.RINGKO_SERVER;
  const previousToken = process.env.RINGKO_WEB_TOKEN; delete process.env.RINGKO_WEB_TOKEN;
  let app: ReturnType<typeof startServer> | undefined;
  try {
    const port = await freePort();
    app = startServer({ workspace: root, port, shared: true });
    expect(readBackendRegistration(root)).toMatchObject({ url: app.url, port, pid: process.pid });
    let starts = 0;
    const tui = await connectBackend({ workspace: root, start: () => { starts += 1; } });
    expect(starts).toBe(0);
    expect(tui.url).toBe(app.url);
    const web = await findLiveBackend({ workspace: root });
    expect(web?.url).toBe(app.url);
    expect((await web!.client.identity()).instance).toBe((await tui.client.identity()).instance);
  } finally {
    app?.stop();
    expect(readBackendRegistration(root)).toBeUndefined();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousServer === undefined) delete process.env.RINGKO_SERVER; else process.env.RINGKO_SERVER = previousServer;
    if (previousToken === undefined) delete process.env.RINGKO_WEB_TOKEN; else process.env.RINGKO_WEB_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

it("reclaims a stale owner and refuses a second backend for the same workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-serve-stale-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  const previousServer = process.env.RINGKO_SERVER; delete process.env.RINGKO_SERVER;
  const previousToken = process.env.RINGKO_WEB_TOKEN; delete process.env.RINGKO_WEB_TOKEN;
  let app: ReturnType<typeof startServer> | undefined;
  let second: ReturnType<typeof startServer> | undefined;
  try {
    const deadPort = await freePort();
    writeBackendRegistration({ workspace: root, configPath: null, url: `http://127.0.0.1:${deadPort}`, port: deadPort, pid: 2_147_483_647, instance: "dead", startedAt: 1 });
    let starts = 0;
    const live = await connectBackend({ workspace: root, start: port => { starts += 1; app = startServer({ workspace: root, port, shared: true }); } });
    expect(starts).toBe(1);
    expect(live.url).toBe(app!.url);
    const secondPort = await freePort();
    expect(() => { second = startServer({ workspace: root, port: secondPort, shared: true }); }).toThrow("already running");
    expect(readBackendRegistration(root)?.url).toBe(live.url);
  } finally {
    second?.stop(); app?.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousServer === undefined) delete process.env.RINGKO_SERVER; else process.env.RINGKO_SERVER = previousServer;
    if (previousToken === undefined) delete process.env.RINGKO_WEB_TOKEN; else process.env.RINGKO_WEB_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects non-local and credential-bearing backend URLs before connecting", async () => {
  for (const url of ['https://remote.invalid', 'http://user:secret@127.0.0.1:8787', 'http://127.0.0.1:8787/path', 'http://127.0.0.1:8787/?token=secret']) {
    await expect(connectBackend({ workspace: process.cwd(), url, startIfMissing: false })).rejects.toThrow("local HTTP origin");
  }
});
