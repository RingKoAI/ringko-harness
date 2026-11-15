import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { NPM_BINARY_TARGETS } from "./npm-platforms.mjs";

const node = Bun.which("node"), npm = Bun.which("npm");
assert.ok(node && npm, "Real npm installation verification requires Node and npm.");
const npmPath = realpathSync(npm);
const npmCli = /\.js$/i.test(npmPath) ? npmPath : join(dirname(npmPath), "node_modules/npm/bin/npm-cli.js");
const root = mkdtempSync(join(tmpdir(), "rkh-npm-installed-"));
const tools = join(root, "tools"); mkdirSync(tools);
if (process.platform === "win32") writeFileSync(join(tools, "node.exe"), readFileSync(node), { flag: "wx" });
else symlinkSync(node, join(tools, "node"));
const env = { ...process.env, RINGKO_HOME: join(root, "home"), AGENTS_HOME: join(root, "home") };
env.PATH = process.platform === "win32" ? `${tools};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : `${tools}:/usr/bin:/bin:/usr/sbin:/sbin`;
delete env.RINGKO_NPM_ROOT; delete env.RINGKO_SERVER; delete env.NODE_PATH; delete env.RINGKO_WEB_TOKEN; delete env.RINGKO_HOST; delete env.RINGKO_WEBUI_DIR;
if (process.platform === "linux") {
  const python = Bun.which("python3") ?? Bun.which("python");
  if (python) env.PYTHON = python;
}
let frontend, backendUrl, socket;
function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  return result.stdout;
}
function pack(directory) { const output = run(node, [npmCli, "pack", directory, "--pack-destination", root, "--json", "--ignore-scripts"]); return join(root, JSON.parse(output)[0].filename); }
try {
  const foundBun = spawnSync(process.platform === "win32" ? join(process.env.SystemRoot, "System32/where.exe") : "/usr/bin/which", ["bun"], { env, encoding: "utf8" });
  assert.notEqual(foundBun.status, 0, "The installation probe must not be able to find Bun on PATH.");
  const target = NPM_BINARY_TARGETS.find(target => target.platform === process.platform && target.arch === process.arch);
  assert.ok(target);
  const source = resolve(import.meta.dir, "../../../dist/npm-tui");
  const version = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
  const platform = pack(resolve(import.meta.dir, "../../../dist/npm-platforms", `${target.platform}-${target.arch}`));
  const main = pack(source);
  const prefix = join(root, "installed"); mkdirSync(prefix);
  // Explicit local tarballs satisfy the exact optional version without publishing
  // test versions. All package manifests and npm-generated shims remain real.
  // node-pty has a normal native dependency install on Linux; keep its install
  // hook enabled rather than claiming a missing prebuild is a working terminal.
  run(node, [npmCli, "install", "--prefix", prefix, "--no-audit", "--no-fund", "--package-lock=false", main, platform]);
  const entry = join(prefix, "node_modules/@ringko-ai/rkh/bin/ringko.mjs");
  assert.ok(existsSync(entry));
  mkdirSync(join(root, "home/.ringko"), { recursive: true });
  writeFileSync(join(root, "home/.ringko/settings.local.json"), JSON.stringify({ updates: { checkOnStartup: false }, instructionScan: { recursive: false } }));
  assert.equal(run(node, [entry, "--version"]).trim(), `ringko ${version}`);
  assert.equal(run(node, [npmCli, "exec", "--offline", "--prefix", prefix, "--", "ringko", "--version"]).trim(), `ringko ${version}`);
  assert.equal(run(node, [entry, "run", "npm-installed-no-bun", "--workspace", root]).trim(), "echo: npm-installed-no-bun");
  // A synthetic POSIX PTY does not answer the terminal capability queries Ink
  // waits for, so the TUI probe is only reliable on Windows ConPTY. The Web
  // terminal check below still exercises the installed node-pty bridge on every
  // platform; the CLI probes above cover the launcher and headless runs.
  if (process.platform === "win32") console.log(run(node, [resolve(import.meta.dir, "check-npm-terminal.cjs"), entry, root]).trim());
  else console.log("Skipped node-pty-driven TUI probe on POSIX; the Web terminal probe below covers the installed PTY bridge.");
  // Isolated explicit human terminal exercises the installed Node PTY bridge,
  // including platforms that cannot load node-pty from a compiled virtual path.
  writeFileSync(join(root, "home/.ringko/settings.local.json"), JSON.stringify({ updates: { checkOnStartup: false }, sandbox: { mode: "danger-full-access" }, instructionScan: { recursive: false } }));
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port; probe.stop(true);
  frontend = Bun.spawn([node, entry, "web", "--workspace", root, "--port", String(port)], { cwd: root, env, stdout: "ignore", stderr: "pipe" });
  const stderr = new Response(frontend.stderr).text();
  const origin = `http://127.0.0.1:${port}`, deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.equal(frontend.exitCode, null, `Installed Web frontend exited: ${frontend.exitCode === null ? "" : await stderr}`);
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(500) }); if (response.ok) { await response.body?.cancel(); backendUrl = origin; break; } await response.body?.cancel(); } catch { /* Startup is bounded below. */ }
    await Bun.sleep(100);
  }
  assert.ok(backendUrl, "Installed Web frontend did not enable pages.");
  const response = await fetch(`${origin}/api/terminal`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ cols: 80, rows: 24 }) });
  const terminal = await response.json(); assert.equal(response.status, 200, JSON.stringify(terminal));
  socket = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/${terminal.id}/socket`, { headers: { origin } });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Installed PTY timed out.")), 15000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "input", data: "echo NPM_PTY_WITHOUT_BUN\r\nexit\r\n" })), { once: true });
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "output") output += message.data;
      if (message.type === "error") { clearTimeout(timer); reject(new Error(message.message)); }
      if (message.type === "exit") { clearTimeout(timer); try { assert.ok(output.includes("NPM_PTY_WITHOUT_BUN")); resolve(); } catch (error) { reject(error); } }
    });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Installed PTY socket failed.")); }, { once: true });
  });
  console.log(`Verified real npm install without external Bun: ${target.platform}-${target.arch}, CLI/run, Web assets, detached backend and installed node-pty bridge.`);
} finally {
  socket?.close();
  if (frontend) {
    if (backendUrl) { try { const response = await fetch(`${backendUrl}/api/backend/stop`, { method: "POST", signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); } catch { /* The isolated backend may already be closed. */ } }
    const timer = setTimeout(() => frontend.kill(), 10000);
    try { await frontend.exited; } finally { clearTimeout(timer); }
  }
  // A detached Windows backend can release its cwd a moment after the frontend
  // exits; retry cleanup instead of failing an otherwise successful install.
  for (let attempt = 0; ; attempt += 1) {
    try { rmSync(root, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt >= 40) { console.warn(`Warning: could not remove isolated npm fixture ${root}: ${error instanceof Error ? error.message : String(error)}`); break; }
      await Bun.sleep(250);
    }
  }
}
