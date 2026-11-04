// Interactive terminal process bridge.

import { join } from "node:path";

const TERMINAL_START_TIMEOUT_MS = 10_000;

export interface InteractiveTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onError(handler: (message: string) => void): void;
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): void;
}

export async function startInteractiveTerminal(
  shell: string,
  args: string[],
  cwd: string,
  cols: number,
  rows: number,
  nativeProtocol = false,
  environment?: NodeJS.ProcessEnv,
): Promise<InteractiveTerminal> {
  const nodePath = Bun.which("node");
  if (!nativeProtocol && !nodePath) throw new Error("Interactive terminals require Node.js in PATH.");
  const bridgePath = join(import.meta.dir, "../terminal-bridge.mjs");
  const child = Bun.spawn(nativeProtocol ? [shell, ...args] : [nodePath!, bridgePath], {
    cwd,
    env: environment ?? { ...process.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let dataHandler: (data: string) => void = () => {};
  let errorHandler: (message: string) => void = () => {};
  let exitHandler: (event: { exitCode: number; signal?: number }) => void = () => {};
  let exitReceived = false;
  let startupSettled = false;
  let resolveStartup!: () => void;
  let rejectStartup!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
  const startupTimer = setTimeout(() => failStartup(new Error("Terminal bridge startup timed out.")), TERMINAL_START_TIMEOUT_MS);
  const failStartup = (error: Error) => {
    if (startupSettled) return;
    startupSettled = true;
    clearTimeout(startupTimer);
    rejectStartup(error);
  };

  const sendControl = (message: Record<string, unknown>): void => {
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      child.stdin.flush();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      failStartup(error);
      errorHandler(error.message);
    }
  };

  const terminal: InteractiveTerminal = {
    write: (data) => sendControl({ type: "input", data }),
    resize: (nextCols, nextRows) => sendControl({ type: "resize", cols: nextCols, rows: nextRows }),
    kill: () => {
      sendControl({ type: "dispose" });
      const forceKill = setTimeout(() => child.kill(), 1_500);
      forceKill.unref?.();
    },
    onData: (handler) => { dataHandler = handler; },
    onError: (handler) => { errorHandler = handler; },
    onExit: (handler) => { exitHandler = handler; },
  };

  void new Response(child.stderr).text().then((stderr) => {
    if (stderr.trim() && !exitReceived) { failStartup(new Error(stderr.trim())); errorHandler(stderr.trim()); }
  }).catch(cause => failStartup(cause instanceof Error ? cause : new Error(String(cause))));

  void (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line) {
            const event = JSON.parse(line) as { type?: unknown; data?: unknown; message?: unknown; exitCode?: unknown; signal?: unknown };
            if (event.type === "ready" && !startupSettled) {
              startupSettled = true;
              clearTimeout(startupTimer);
              resolveStartup();
            } else if (event.type === "output" && typeof event.data === "string") dataHandler(event.data);
            else if (event.type === "error" && typeof event.message === "string") { failStartup(new Error(event.message)); errorHandler(event.message); }
            else if (event.type === "exit") {
              exitReceived = true;
              exitHandler({
                exitCode: typeof event.exitCode === "number" ? event.exitCode : 1,
                ...(typeof event.signal === "number" ? { signal: event.signal } : {}),
              });
            }
          }
          newline = pending.indexOf("\n");
        }
      }
      pending += decoder.decode();
      if (pending.trim()) throw new Error("Terminal bridge ended with an incomplete event.");
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      failStartup(error);
      errorHandler(error.message);
    } finally {
      reader.releaseLock();
      const exitCode = await child.exited;
      failStartup(new Error(`Terminal bridge exited before becoming ready (exit ${exitCode}).`));
      if (!exitReceived) exitHandler({ exitCode });
    }
  })();

  if (!nativeProtocol) sendControl({ type: "start", shell, args, cwd, cols, rows });
  try { await ready; return terminal; }
  catch (error) { child.kill(); await child.exited; throw error; }
}

