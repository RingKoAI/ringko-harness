import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NPM_BINARY_TARGETS } from "./npm-platforms.mjs";
import { spawnSync } from "node:child_process";

const source = resolve(import.meta.dir, "../../../dist/npm-tui");
const root = mkdtempSync(join(tmpdir(), "ringko-npm-check-"));
const installed = join(root, "package");
const timeoutMs = 30_000;
let server;
let backendUrl;

try {
  // Exercise relocation outside the monorepo, without workspace dependencies.
  cpSync(source, installed, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  if (manifest.private === true) {
    assert.deepEqual(manifest.os, [process.platform]); assert.deepEqual(manifest.cpu, [process.arch]);
  } else assert.equal(manifest.private, undefined);
  assert.equal(manifest.name, "@ringko-ai/rkh");
  assert.equal(manifest.bin.ringko, "bin/ringko.mjs");
  assert.equal(manifest.engines.bun, undefined);
  assert.match(readFileSync(join(installed, "bin/ringko.mjs"), "utf8"), /^#!\/usr\/bin\/env node/);
  assert.ok(manifest.dependencies["node-pty"]);
  const runtimeDependencies = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
  for (const desktopPackage of ["@ringko-ai/rkh-desktop", "electron", "electron-builder", "electron-vite"]) {
    assert.equal(runtimeDependencies[desktopPackage], undefined, `CLI must not install desktop dependency ${desktopPackage}`);
  }
  assert.equal(existsSync(join(installed, "packages/rkh-desktop")), false, "Desktop workspace must not be shipped in the CLI package");
  assert.ok(existsSync(join(installed, "bin/terminal-bridge.mjs")));
  const cli = join(installed, manifest.bin.ringko);
  const target = NPM_BINARY_TARGETS.find(target => target.platform === process.platform && target.arch === process.arch);
  assert.ok(target, "Unsupported verification platform");
  assert.equal(manifest.optionalDependencies[target.name], manifest.version);
  // Model npm's platform-selected optional dependency in isolated storage. npm
  // tarball installation is additionally verified by check-npm-install.mjs.
  const platformSource = resolve(import.meta.dir, "../../../dist/npm-platforms", `${process.platform}-${process.arch}`);
  const platformInstalled = join(installed, "node_modules", ...target.name.split("/"));
  mkdirSync(join(platformInstalled, "bin"), { recursive: true });
  cpSync(platformSource, platformInstalled, { recursive: true });
  writeFileSync(join(platformInstalled, "bin", target.binary), readFileSync(join(platformSource, "bin", target.binary)));
  const node = Bun.which("node"); assert.ok(node, "Verification requires Node.js");
  // Deliberately remove Bun and all non-system tools from the child PATH.
  const env = { ...process.env, RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "agents") };
  env.PATH = process.platform === "win32" ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : "/usr/bin:/bin:/usr/sbin:/sbin";
  const foundBun = spawnSync(process.platform === "win32" ? join(process.env.SystemRoot, "System32/where.exe") : "/usr/bin/which", ["bun"], { env, encoding: "utf8" });
  assert.notEqual(foundBun.status, 0, "The runtime probe must not find external Bun.");
  delete env.RINGKO_SERVER;
  delete env.RINGKO_WEBUI_DIR;
  delete env.RINGKO_WEB_TOKEN;
  // A relocated bundle must resolve offline capacity without source JSON files.
  const metadata = JSON.parse(readFileSync(resolve(import.meta.dir, "../../config/models.metadata.json"), "utf8"));
  const [catalogProvider, catalogEntry] = Object.entries(metadata)[0];
  const [catalogModel] = Object.values(catalogEntry.models);
  const configRoot = join(env.RINGKO_HOME, ".ringko");
  mkdirSync(configRoot, { recursive: true });
  writeFileSync(join(configRoot, "settings.local.json"), JSON.stringify({ updates: { checkOnStartup: false } }));
  writeFileSync(join(configRoot, "provider.json"), JSON.stringify({
    model: "Smoke/alias",
    providers: [{ name: "Smoke", type: "echo", models: [{ id: "alias", name: "Offline model", catalogId: `${catalogProvider}/${catalogModel.id}` }] }],
  }));
  env.RINGKO_MODELS_URL = "http://127.0.0.1:0/catalog.json";

  for (const [args, expected] of [
    [["version"], `ringko ${manifest.version}`],
    [["run", "npm-smoke-test"], "echo: npm-smoke-test"],
  ]) {
    const result = Bun.spawnSync([node, cli, ...args], { cwd: root, env, timeout: timeoutMs });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString().trim(), expected);
  }

  const help = Bun.spawnSync([node, cli, "help"], { cwd: root, env, timeout: timeoutMs });
  assert.equal(help.exitCode, 0, help.stderr.toString());
  assert.match(help.stdout.toString(), /ringko <command>/);

  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  server = Bun.spawn([node, cli, "web", "--shared", "--port", String(port)], {
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
      if (response.ok) break;
      await response.body?.cancel(); await Bun.sleep(100);
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
  const info = await (await fetch(`${url}/api/info`, { signal })).json();
  assert.equal(info.workspace, realpathSync(root), "Packaged backend belongs to a different workspace");
  backendUrl = url;
  const owner = await (await fetch(`${url}/api/backend`, { signal })).json();
  assert.equal(owner.lifecycle.web, 1, "Packaged Web command must retain one frontend lease");
  const upload = new FormData(); upload.append("file", new File(["native-package-smoke"], "native.txt"));
  const uploaded = await fetch(`${url}/api/upload`, { method: "POST", body: upload, signal });
  assert.equal(uploaded.status, 200, "Relocated package's native file module is unavailable");
  const saved = await uploaded.json();
  assert.equal(readFileSync(join(root, saved.files[0].path), "utf8"), "native-package-smoke");
  assert.equal(info.context.limit, catalogModel.limit.context, "Bundled offline model metadata was not restored");
  assert.ok(info.tools.includes("plan") && info.tools.includes("update_plan"), "Plan tools are missing from the packaged backend");
  assert.ok(!info.tools.includes("todoread") && !info.tools.includes("todowrite"), "Legacy todo names must not be offered to models");
  const usageResponse = await fetch(`${url}/api/usage?limit=1`, { signal });
  assert.equal(usageResponse.status, 200, "Packaged usage statistics API is missing");
  const usage = await usageResponse.json();
  assert.equal(usage.workspace, info.workspace);
  assert.ok(Array.isArray(usage.requests) && Number.isSafeInteger(usage.total));
  console.log(`Verified Node-launched ${manifest.name}@${manifest.version} without Bun on PATH: CLI, echo, WebUI, embedded native upload, usage and model capacity.`);
} finally {
  if (server) {
    // The foreground Web owner and detached execution worker are separate now.
    if (backendUrl) {
      try { const response = await fetch(`${backendUrl}/api/backend/stop`, { method: "POST", signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); }
      catch { /* An exited test backend requires no further shutdown request. */ }
    }
    const timer = setTimeout(() => server.kill(), 10_000);
    try { await server.exited; } finally { clearTimeout(timer); }
  }
  rmSync(root, { recursive: true, force: true });
}
