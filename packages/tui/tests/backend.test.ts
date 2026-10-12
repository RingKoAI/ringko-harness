import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "@ringko-ai/app";
import { connectBackend, sharedPort } from "../src/backend.ts";

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

it("rejects non-local and credential-bearing backend URLs before connecting", async () => {
  for (const url of ['https://remote.invalid', 'http://user:secret@127.0.0.1:8787', 'http://127.0.0.1:8787/path', 'http://127.0.0.1:8787/?token=secret']) {
    await expect(connectBackend({ workspace: process.cwd(), url, startIfMissing: false })).rejects.toThrow("local HTTP origin");
  }
});
