import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";

it("starts an authenticated interactive PTY and streams command output over WebSocket", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-terminal-api-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  mkdirSync(join(root, ".ringko"), { recursive: true });
  writeFileSync(join(root, ".ringko", "settings.local.json"), JSON.stringify({ sandbox: { mode: "danger-full-access" } }));
  const app = startServer({ workspace: root, port: 0, authToken: "terminal-test-token" });
  let socket: WebSocket | undefined;
  try {
    const unauthorized = await fetch(`${app.url}/api/terminal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(unauthorized.status).toBe(401);

    const headers = {
      authorization: "Bearer terminal-test-token",
      "content-type": "application/json",
      origin: app.url,
    };
    const crossOrigin = await fetch(`${app.url}/api/terminal`, {
      method: "POST",
      headers: { ...headers, origin: "http://example.invalid" },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(crossOrigin.status).toBe(403);

    const invalidDimensions = await fetch(`${app.url}/api/terminal`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cols: 10, rows: 24 }),
    });
    expect(invalidDimensions.status).toBe(400);

    const created = await fetch(`${app.url}/api/terminal`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    if (created.status !== 200) throw new Error(`Terminal startup failed (HTTP ${created.status}): ${await created.text()}`);
    expect(created.status).toBe(200);
    const { id } = await created.json() as { id: string };

    const socketUrl = new URL(`/api/terminal/${id}/socket`, app.url);
    socketUrl.protocol = "ws:";
    socket = new WebSocket(socketUrl, { headers: { origin: app.url } });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Terminal websocket did not open.")), 1_500);
      socket!.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket!.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Terminal websocket failed.")); }, { once: true });
      socket!.addEventListener("close", (event) => {
        clearTimeout(timeout);
        reject(new Error(`Terminal websocket closed (${event.code}): ${event.reason}`));
      }, { once: true });
    });

    const output = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Interactive shell did not return command output.")), 2_500);
      let received = "";
      socket!.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; data?: string; message?: string };
        if (message.type === "error") { clearTimeout(timeout); reject(new Error(message.message ?? "Terminal bridge failed.")); return; }
        if (message.type === "output") received += message.data ?? "";
        if (received.includes("RINGKO_PTY_READY")) {
          clearTimeout(timeout);
          resolve(received);
        }
      });
    });
    const command = process.platform === "win32"
      ? "echo RINGKO_PTY_READY\r\n"
      : "printf 'RINGKO_PTY_READY\\n'\r";
    await new Promise((resolve) => setTimeout(resolve, 200));
    socket.send(JSON.stringify({ type: "input", data: command }));
    expect(await output).toContain("RINGKO_PTY_READY");

    const exited = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Interactive shell did not exit.")), 5_000);
      socket!.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as { type: string };
        if (message.type === "exit") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    socket.send(JSON.stringify({ type: "input", data: "exit\r" }));
    await exited;

    const disposed = await fetch(`${app.url}/api/terminal/${id}`, { method: "DELETE", headers });
    expect(disposed.status).toBe(200);
  } finally {
    socket?.close();
    app.stop();
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (previousHome === undefined) delete process.env.RINGKO_HOME;
    else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, process.platform === "win32" ? 30_000 : 15_000);

it("returns a startup error when the PTY shell cannot be spawned", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-terminal-failure-"));
  const previousHome = process.env.RINGKO_HOME;
  const shellVariable = process.platform === "win32" ? "COMSPEC" : "SHELL";
  const previousShell = process.env[shellVariable];
  process.env.RINGKO_HOME = root;
  process.env[shellVariable] = join(root, "missing-shell-executable");
  mkdirSync(join(root, ".ringko"), { recursive: true });
  writeFileSync(join(root, ".ringko", "settings.local.json"), JSON.stringify({ sandbox: { mode: "danger-full-access" } }));
  const app = startServer({ workspace: root, port: 0, authToken: "terminal-failure-token" });
  try {
    const response = await fetch(`${app.url}/api/terminal`, {
      method: "POST",
      headers: { origin: app.url, authorization: "Bearer terminal-failure-token", "content-type": "application/json" },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(response.status).toBe(500);
    expect((await response.json() as { error: string }).error.length).toBeGreaterThan(0);
  } finally {
    app.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousShell === undefined) delete process.env[shellVariable]; else process.env[shellVariable] = previousShell;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 15_000);



