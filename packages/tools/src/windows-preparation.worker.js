import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

// Only trusted native preparation commands reach this worker. Keep even the
// Windows process-creation syscall off the backend's HTTP event loop.
async function run({ executable, args, env, timeout, outputLimit, stopTimeout }) {
  const child = Bun.spawn([executable, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  let failure, stopping;
  let bytes = 0;
  const stop = () => stopping ??= (async () => {
    if (child.exitCode !== null) return;
    try {
      const killer = Bun.spawn([join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), "/pid", String(child.pid), "/t", "/f"], {
        env, stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true,
      });
      const force = setTimeout(() => { killer.kill(); child.kill(); }, stopTimeout);
      try { await killer.exited; } finally { clearTimeout(force); }
    } catch { /* The process may already have exited; retain direct-handle cleanup. */ }
    finally { child.kill(); }
  })();
  const read = async stream => {
    const chunks = [];
    for await (const chunk of stream) {
      const keep = Math.max(0, Math.min(chunk.length, outputLimit - bytes));
      if (keep) chunks.push(Buffer.from(chunk.subarray(0, keep)));
      bytes += chunk.length;
      if (bytes > outputLimit && !failure) { failure = new Error("Windows sandbox preparation exceeded its output limit."); void stop(); }
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  const timer = setTimeout(() => { failure ??= new Error("Windows sandbox preparation timed out."); void stop(); }, timeout);
  try {
    const [stdout, stderr, code] = await Promise.all([read(child.stdout), read(child.stderr), child.exited]);
    if (failure) throw failure;
    if (code !== 0) throw new Error(stderr || stdout || `Preparation process exited (${code}).`);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) await stop();
    if (stopping) await stopping;
  }
}

try { await run(workerData); parentPort.postMessage({ ok: true }); }
catch (error) { parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : "Windows sandbox preparation failed." }); }
finally { parentPort.close(); }
