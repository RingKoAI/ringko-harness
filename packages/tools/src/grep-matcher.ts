/// <reference path="./native-source.d.ts" />
import { Worker } from "node:worker_threads";
import { SEARCH_LIMITS } from "./limits.ts";
import source from "./grep-match.worker.js" with { type: "text" };
import { FILE_LIMITS } from "./limits.ts";
import { nativeFileBinding } from "./native-file-loader.ts";

export interface FileMatches { matches: { line: number; text: string }[]; skipped: number; count: number; bytes: number; skipFile?: boolean; error?: string }

/** The model's RegExp runs in a disposable worker, never the HTTP/UI event loop. */
export class GrepMatcher {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private failure?: Error;
  constructor(pattern: string, caseInsensitive: boolean, private readonly signal: AbortSignal) {
    this.worker = new Worker(new URL(`data:application/javascript,${encodeURIComponent(source)}`), { workerData: { pattern, flags: caseInsensitive ? "i" : "", binding: nativeFileBinding(), fileBytes: SEARCH_LIMITS.fileBytes, chunkBytes: FILE_LIMITS.ioChunkBytes } });
    this.worker.on("error", error => { this.failure = error; });
    this.ready = this.exchange<{ ready?: boolean; error?: string }>().then(message => { if (message.ready !== true) throw new Error(message.error ?? "Regex worker initialization failed."); });
  }
  private exchange<T>(request?: unknown): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<T>((resolve, reject) => {
      const finish = (error?: unknown, value?: T) => {
        clearTimeout(timer); this.signal.removeEventListener("abort", abort);
        this.worker.off("message", receive); this.worker.off("error", fail); this.worker.off("exit", exited);
        if (error !== undefined) reject(error); else resolve(value!);
      };
      const receive = (message: T) => finish(undefined, message);
      const fail = (error: Error) => finish(error);
      const exited = (code: number) => finish(new Error(`Regex worker exited before completion (${code}).`));
      const abort = () => finish(this.signal.reason ?? new Error("Grep cancelled."));
      const timer = setTimeout(() => finish(new Error("Grep regular expression exceeded its match deadline; narrow the pattern or path.")), SEARCH_LIMITS.matchMs);
      this.worker.once("message", receive); this.worker.once("error", fail); this.worker.once("exit", exited);
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
      else if (request !== undefined) { try { this.worker.postMessage(request); } catch (error) { finish(error); } }
    });
  }
  async match(path: string, skip: number, limit: number, content: boolean, remainingBytes: number): Promise<FileMatches> {
    await this.ready;
    this.signal.throwIfAborted();
    const result = await this.exchange<FileMatches>({ path, skip, limit, content, remainingBytes, lineLimit: SEARCH_LIMITS.lineCharacters });
    if (result.error) throw new Error(result.error);
    return result;
  }
  async initialized(): Promise<void> { await this.ready; }
  async close(): Promise<void> { await this.worker.terminate(); }
}
