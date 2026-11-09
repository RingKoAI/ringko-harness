/// <reference path="./native-source.d.ts" />
import { Worker } from "node:worker_threads";
import { FILE_LIMITS } from "./limits.ts";
import { nativeFileBinding } from "./native-file-loader.ts";
import type { FileOperation, FileOperationResult } from "./file-operation.ts";
import source from "./file-operation.worker.js" with { type: "text" };

/** The native env finalizer closes resources even if a worker is terminated. */
export async function nativeFileOperation(path: string, operation: FileOperation, signal?: AbortSignal): Promise<FileOperationResult> {
  const binding = nativeFileBinding();
  const worker = new Worker(new URL(`data:application/javascript,${encodeURIComponent(source)}`), { workerData: { path, operation, limits: FILE_LIMITS, binding } });
  let timeout: Error | undefined;
  let cancelled = false, cancellation: unknown;
  const abort = () => { cancelled = true; cancellation ??= signal?.reason; worker.postMessage({ commit: false }); };
  const timer = setTimeout(() => { timeout = new Error("Safe file operation exceeded its deadline."); abort(); }, FILE_LIMITS.operationMs);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    return await new Promise<FileOperationResult>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`Safe file worker exited before settlement (${code}).`)));
      worker.on("message", (message: { prepared?: boolean; ok?: boolean; result?: FileOperationResult; error?: string; code?: string; committed?: boolean }) => {
        if (message.prepared) {
          try { signal?.throwIfAborted(); worker.postMessage({ commit: timeout === undefined }); }
          catch (error) { cancellation = error; abort(); }
          return;
        }
        if (timeout) reject(Object.assign(timeout, { committed: message.committed || message.ok === true, result: message.result }));
        else if (cancelled) {
          const error = new Error(cancellation instanceof Error ? cancellation.message : "File operation aborted.", { cause: cancellation });
          error.name = "AbortError";
          reject(Object.assign(error, { committed: message.committed || message.ok === true, result: message.result }));
        }
        else if (message.ok === true && message.result) resolve(message.result);
        else reject(Object.assign(new Error(message.error ?? "Safe file operation failed."), { code: message.code, committed: message.committed, result: message.result }));
      });
    });
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); await worker.terminate(); }
}
