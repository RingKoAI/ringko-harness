import { format } from "node:util";
import { writeDiagnostic } from "@ringko-ai/config";

/** Install before rendering; restore after the renderer has cleaned up. */
export function isolateTerminalDiagnostics(): () => void {
  const methods = ["log", "info", "debug", "warn", "error", "trace", "assert"] as const;
  const originals = new Map<string, (...args: any[]) => void>();
  const replacements = new Map<string, (...args: any[]) => void>();
  const originalWrite = process.stderr.write;
  let writing = false;
  const record = (source: string, message: string): void => {
    if (writing) return;
    writing = true;
    try { writeDiagnostic(source, message); } finally { writing = false; }
  };
  for (const method of methods) {
    originals.set(method, console[method]);
    const replacement = (...args: unknown[]): void => {
      if (method === "assert" && args.shift()) return;
      record(`console.${method}`, format(...args));
    };
    replacements.set(method, replacement);
    console[method] = replacement;
  }
  const intercept = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    record("stderr", typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    if (done) queueMicrotask(() => done());
    return true;
  }) as typeof process.stderr.write;
  process.stderr.write = intercept;
  return () => {
    for (const method of methods) {
      if (console[method] === replacements.get(method)) console[method] = originals.get(method)!;
    }
    if (process.stderr.write === intercept) process.stderr.write = originalWrite;
  };
}
