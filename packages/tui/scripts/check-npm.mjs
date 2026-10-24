import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(import.meta.dir, "../../../dist/npm-tui");
const root = mkdtempSync(join(tmpdir(), "ringko-npm-check-"));
const installed = join(root, "package");
const timeoutMs = 30_000;
let server;

try {
  // Exercise relocation outside the monorepo, without workspace dependencies.
  cpSync(source, installed, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(manifest.private, undefined);
  assert.ok(manifest.dependencies["node-pty"]);
  assert.ok(existsSync(join(installed, "bin/terminal-bridge.mjs")));
  const cli = join(installed, manifest.bin.ringko);
  const env = { ...process.env, RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") };
  delete env.RINGKO_SERVER;
  delete env.RINGKO_WEBUI_DIR;
  delete env.RINGKO_WEB_TOKEN;

  for (const [args, expected] of [
    [["version"], `ringko ${manifest.version}`],
    [["run", "npm-smoke-test"], "echo: npm-smoke-test"],
  ]) {
    const result = Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, timeout: timeoutMs });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString().trim(), expected);
  }

  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  server = Bun.spawn([process.execPath, cli, "serve", "--shared", "--port", String(port)], {
    cwd: root, env, stdout: "pipe", stderr: "pipe",
  });
  const stderr = new Response(server.stderr).text();
  const url = `http://127.0.0.1:${port}`;
  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  while (!signal.aborted) {
    if (server.exitCode !== null) throw new Error(`Packaged backend exited: ${await stderr}`);
    try {
      response = await fetch(url, { signal });
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  signal.throwIfAborted();
  assert.ok(response?.ok, `Packaged WebUI failed: ${response?.status}`);
  const html = await response.text();
  assert.match(html, /<title>RingKo<\/title>/);
  const asset = /src="(\/assets\/[^" ]+\.js)"/.exec(html)?.[1];
  assert.ok(asset, "WebUI entry script is missing");
  const script = await fetch(new URL(asset, url), { signal });
  assert.ok(script.ok, `Packaged WebUI asset failed: ${script.status}`);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  await script.body?.cancel();
  console.log(`Verified relocated ${manifest.name}@${manifest.version}: CLI, echo and WebUI.`);
} finally {
  if (server) {
    server.kill();
    await server.exited;
  }
  rmSync(root, { recursive: true, force: true });
}
