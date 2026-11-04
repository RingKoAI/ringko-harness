import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeSupervisor } from "@ringko-ai/sdk/runtime";
import { startServer } from "../src/server.ts";

it("uses the runtime host supplied by the main entry", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-runtime-host-"));
  const previousHome = process.env.RINGKO_HOME;
  const previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  process.env.AGENTS_HOME = join(root, "home");
  const host = new RuntimeSupervisor();
  const app = startServer({ workspace: root, port: 0, runtimeHost: host });
  try {
    expect((await fetch(`${app.url}/api/skills`)).status).toBe(200);
    expect(host.list()).toHaveLength(1);
    const runtime = host.get(root);
    expect(host.get(root)).toBe(runtime);
  } finally {
    app.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
  expect(() => host.get(root)).toThrow("closed");
}, 30_000);
