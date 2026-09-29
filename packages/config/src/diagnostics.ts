import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { ringkoRoot } from "./paths.ts";

const MAX_MESSAGE_LENGTH = 16 * 1024;
const MAX_LOG_BYTES = 4 * 1024 * 1024;

export function diagnosticLogPath(): string {
  return join(ringkoRoot(), "logs", "diagnostics.jsonl");
}

/** Diagnostics are best-effort and never write back to the terminal. */
export function writeDiagnostic(source: string, message: string): boolean {
  try {
    const directory = join(ringkoRoot(), "logs");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = diagnosticLogPath();
    let size = 0;
    try { size = statSync(path).size; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (size >= MAX_LOG_BYTES) renameSync(path, `${path}.previous`);
    const text = message.slice(0, MAX_MESSAGE_LENGTH)
      .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
      .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[redacted]");
    appendFileSync(path, `${JSON.stringify({ timestamp: new Date().toISOString(), source: source.slice(0, 256), message: text, truncated: message.length > MAX_MESSAGE_LENGTH })}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
