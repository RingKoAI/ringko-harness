/// <reference path="./native-source.d.ts" />
import { Worker } from "node:worker_threads";
import { nativeFileBinding } from "./native-file-loader.ts";
import { FILE_LIMITS } from "./limits.ts";
import source from "./file-operation.worker.js" with { type: "text" };

/** Kernel-held lock: no PID files, stale-owner reclamation or cross-process quota race. */
export async function acquireFileLock(path: string, signal?: AbortSignal): Promise<() => Promise<void>> {
  signal?.throwIfAborted();
  const worker = new Worker(new URL(`data:application/javascript,${encodeURIComponent(source)}`), { workerData: { path, operation: { kind: "lock" }, limits: FILE_LIMITS, binding: nativeFileBinding() } });
  const ready = Promise.withResolvers<void>(), closed = Promise.withResolvers<void>();
  void closed.promise.catch(() => {});
  let acquired = false, completed = false, releasing: Promise<void> | undefined;
  const abort = () => { ready.reject(signal?.reason ?? new Error("Storage lock acquisition cancelled.")); worker.postMessage({ commit: false, release: true }); };
  const timer = setTimeout(() => { ready.reject(new Error("Storage lock acquisition timed out.")); worker.postMessage({ commit: false, release: true }); }, FILE_LIMITS.operationMs);
  const fail = (error: Error) => { ready.reject(error); closed.reject(error); };
  worker.once("error", fail);
  worker.once("exit", code => { if (!completed) fail(new Error(`Storage lock worker exited before settlement (${code}).`)); });
  worker.on("message", (message: { locked?: boolean; ok?: boolean; error?: string; code?: string }) => {
    if (message.locked) { if (signal?.aborted) abort(); else ready.resolve(); return; }
    completed = true;
    if (message.ok) closed.resolve(); else fail(Object.assign(new Error(message.error ?? "Storage lock failed."), { code: message.code }));
  });
  signal?.addEventListener("abort", abort, { once: true });
  try { if (signal?.aborted) abort(); await ready.promise; acquired = true; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); if (!acquired) await worker.terminate(); }
  return () => releasing ??= (async () => {
    worker.postMessage({ release: true });
    try { await closed.promise; } finally { await worker.terminate(); }
  })();
}
