import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
const native = createRequire(process.execPath)(workerData.binding);
const skippedErrors = new Set(["ENOENT", "EACCES", "EPERM", "ELOOP", "ENOTDIR", "ENOTREG", "EBUSY"]);

let regex;
try { regex = new RegExp(workerData.pattern, workerData.flags); parentPort.postMessage({ ready: true }); }
catch (error) { parentPort.postMessage({ ready: false, error: `Invalid regular expression: ${error.message}` }); }

parentPort.on("message", request => {
  if (!regex) return;
  let transaction, bytes = 0, text, skipFile = false;
  try {
    try {
      transaction = native.begin(request.path, "read", false);
      const info = native.info(transaction);
      skipFile = !info.exists || info.size > workerData.fileBytes;
      if (!skipFile) {
        const chunks = [];
        for (;;) {
          const room = Math.min(workerData.fileBytes, request.remainingBytes) - bytes;
          const chunk = native.read(transaction, Math.max(1, Math.min(workerData.chunkBytes, room + 1)));
          if (!chunk.length) break;
          bytes += chunk.length;
          if (bytes > request.remainingBytes) throw new Error("Grep exceeded its cumulative byte budget; narrow path or glob.");
          if (bytes > workerData.fileBytes) { skipFile = true; break; }
          chunks.push(chunk);
        }
        if (!skipFile) {
          const data = Buffer.concat(chunks, bytes);
          skipFile = data.includes(0);
          if (!skipFile) text = data.toString("utf8");
        }
      }
    } finally { if (transaction) { native.close(transaction); transaction = undefined; } }
    if (skipFile) { parentPort.postMessage({ skipFile: true, bytes }); return; }
    // No filesystem handle is held while the model's synchronous RegExp runs.
    const { skip, limit, content, lineLimit } = request;
    const matches = []; let skipped = 0, count = 0, position = 0, line = 1;
    while (position <= text.length) {
      const newline = text.indexOf("\n", position), end = newline < 0 ? text.length : newline;
      const value = text.slice(position, end);
      if (regex.test(value)) {
        count++;
        if (content) {
          if (skipped < skip) skipped++;
          else { matches.push({ line, text: value.length > lineLimit ? value.slice(0, lineLimit) + "…" : value }); if (matches.length >= limit) break; }
        }
      }
      if (newline < 0) break;
      position = newline + 1; line++;
    }
    parentPort.postMessage({ matches, skipped, count, bytes });
  } catch (error) {
    if (skippedErrors.has(error.code)) parentPort.postMessage({ skipFile: true, bytes });
    else parentPort.postMessage({ error: error.message });
  }
});
