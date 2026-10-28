import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "win32") {
  console.log("Skipped Windows standalone ConPTY verification on this platform.");
  process.exit(0);
}

const repository = resolve(import.meta.dir, "../../..");
const binary = resolve(process.argv[2] ?? join(repository, "dist", existsSync(join(repository, "dist/ringko.exe")) ? "ringko.exe" : "ringko"));
assert.ok(existsSync(binary), "Build the standalone CLI before verifying its sandbox.");
const temporary = mkdtempSync(join(tmpdir(), "ringko-bin-sandbox-"));
const workspace = join(temporary, "workspace");
const outside = join(temporary, "outside");
const home = join(temporary, "home");
for (const path of [workspace, outside, home]) mkdirSync(path);
// Archive extraction creates a new executable with the destination's security
// descriptor. Do not inherit a development workspace's Low-integrity label.
const relocatedBinary = join(temporary, "ringko.exe");
writeFileSync(relocatedBinary, readFileSync(binary), { flag: "wx" });
const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = listener.port;
listener.stop(true);
assert.ok(port);
const origin = `http://127.0.0.1:${port}`;
const token = "isolated-sandbox-smoke-token";
const child = Bun.spawn([relocatedBinary, "serve", "--shared", "--workspace", workspace, "--port", String(port)], {
  cwd: temporary,
  env: { ...process.env, RINGKO_HOME: home, AGENTS_HOME: home, RINGKO_WEB_TOKEN: token },
  stdout: "ignore", stderr: "pipe",
});
const stderr = new Response(child.stderr).text();
let socket;
try {
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Standalone backend exited: ${await stderr}`);
    try {
      const response = await fetch(`${origin}/api/info`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* The process has not bound its isolated test port yet. */ }
    await Bun.sleep(100);
  }
  assert.ok(ready, "Standalone backend did not become ready.");
  const response = await fetch(`${origin}/api/terminal`, {
    method: "POST",
    headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ cols: 80, rows: 24 }),
  });
  const created = await response.json();
  assert.equal(response.status, 200, `Compiled native terminal failed: ${JSON.stringify(created)}`);
  const socketUrl = new URL(`/api/terminal/${created.id}/socket`, origin);
  socketUrl.protocol = "ws:";
  socket = new WebSocket(socketUrl, { headers: { origin } });
  const output = await new Promise((resolveOutput, reject) => {
    let text = "";
    const timeout = setTimeout(() => reject(new Error("Compiled native terminal timed out.")), 10_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
      socket.send(JSON.stringify({ type: "input", data: `echo packaged-sandbox>allowed.txt\r\necho forbidden>"${join(outside, "blocked.txt")}"\r\necho COMPILED_CONPTY_OK\r\nexit 0\r\n` }));
    }, { once: true });
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "output") text += message.data;
      else if (message.type === "error") { clearTimeout(timeout); reject(new Error(message.message)); }
      else if (message.type === "exit") {
        clearTimeout(timeout);
        try { assert.equal(message.exitCode, 0); resolveOutput(text); } catch (error) { reject(error); }
      }
    });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Compiled terminal WebSocket failed.")); }, { once: true });
  });
  assert.ok(output.includes("COMPILED_CONPTY_OK"));
  assert.ok(readFileSync(join(workspace, "allowed.txt"), "utf8").includes("packaged-sandbox"));
  assert.equal(existsSync(join(outside, "blocked.txt")), false);
  console.log("Verified standalone Windows ConPTY, embedded helper initialization, workspace writes, and external-write denial.");
} finally {
  socket?.close();
  child.kill();
  await child.exited;
  await stderr;
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
