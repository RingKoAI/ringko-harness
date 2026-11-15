import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";

it("revalidates the WebUI entry document while caching content-hashed assets", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-static-cache-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  const webui = join(root, "webui");
  mkdirSync(join(webui, "assets"), { recursive: true });
  writeFileSync(join(webui, "index.html"), '<script type="module" src="/assets/index-abc12345.js"></script>');
  writeFileSync(join(webui, "assets", "index-abc12345.js"), "console.log('bundle')");
  const app = startServer({ port: 0, workspace: root, shared: true, webuiDir: webui });
  try {
    const document = await fetch(`${app.url}/`);
    expect(document.status).toBe(200);
    expect(document.headers.get("cache-control")).toBe("no-cache");
    expect(await document.text()).toContain("index-abc12345.js");
    const asset = await fetch(`${app.url}/assets/index-abc12345.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    await asset.body?.cancel();
  } finally {
    app.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("does not follow a WebUI link that escapes the asset root", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-static-link-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  const webui = join(root, "webui"), outside = join(root, "outside");
  mkdirSync(join(webui, "assets"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(webui, "index.html"), "Isolated WebUI fixture");
  writeFileSync(join(outside, "sentinel.json"), "fixture-outside-web-root");
  symlinkSync(outside, join(webui, "assets/escape"), process.platform === "win32" ? "junction" : "dir");
  const app = startServer({ port: 0, workspace: root, shared: true, webuiDir: webui });
  try {
    const response = await fetch(`${app.url}/assets/escape/sentinel.json`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("fixture-outside-web-root");
  } finally {
    await app.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 30_000);
