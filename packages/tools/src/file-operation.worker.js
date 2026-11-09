// The module contains only standard Node-API calls; no experimental FFI bridge.
import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const { path, operation, limits, binding } = workerData;
const native = createRequire(process.execPath)(binding);
let cancelled = false, decide, releaseLock;
parentPort.on("message", message => {
  if (message.commit === false) cancelled = true;
  if (message.release || cancelled) releaseLock?.();
  decide?.(!cancelled && message.commit === true);
});
const deadline = Date.now() + limits.operationMs;
const yieldNow = () => new Promise(resolve => setImmediate(resolve));
function check() { if (cancelled || Date.now() > deadline) throw new Error("File operation cancelled or timed out before commit."); }
async function commitAllowed() {
  parentPort.postMessage({ prepared: true });
  const commit = await new Promise(resolve => { decide = resolve; if (cancelled) resolve(false); });
  check(); if (!commit) throw new Error("File operation cancelled before commit.");
}
async function run() {
  let transaction, outcome, original, replacements = 0;
  try {
    check();
    transaction = native.begin(path, operation.kind, operation.expectAbsent === true);
    original = native.info(transaction);
    if (operation.kind === "lock") {
      parentPort.postMessage({ locked: true });
      await new Promise(resolve => { releaseLock = resolve; if (cancelled) resolve(); });
      outcome = { ok: true }; return;
    }
    if (operation.kind === "remove") {
      await commitAllowed(); native.remove(transaction, operation.expectedIdentity);
      outcome = { ok: true, result: { bytes: 0, size: 0, mtimeMs: 0, created: false, replacements: 0, identity: operation.expectedIdentity } };
      return;
    }
    let content;
    if (operation.kind === "edit") {
      if (!operation.oldString) throw new Error("old_string must not be empty.");
      const chunks = []; let total = 0;
      for (;;) {
        check(); const data = native.read(transaction); if (!data.length) break;
        total += data.length;
        if (total > limits.sourceBytes) throw new Error("Edit source exceeds the 64 MiB size limit.");
        chunks.push(data);
        if (total % (limits.ioChunkBytes * 16) === 0) await yieldNow();
      }
      content = Buffer.concat(chunks, total).toString("utf8");
      for (let index = content.indexOf(operation.oldString); index >= 0; index = content.indexOf(operation.oldString, index + operation.oldString.length)) {
        if (++replacements > limits.replacements) throw new Error("Edit exceeds the replacement-count limit; narrow the edit.");
      }
      if (!replacements) throw new Error("'old_string' was not found in the file.");
      if (replacements > 1 && !operation.replaceAll) throw new Error(`'old_string' occurs ${replacements} times; set replace_all or provide a more specific string.`);
      const size = Buffer.byteLength(content) + replacements * (Buffer.byteLength(operation.newString) - Buffer.byteLength(operation.oldString));
      if (!Number.isSafeInteger(size) || size > limits.outputBytes) throw new Error("Edited content exceeds the 64 MiB output limit.");
      content = operation.replaceAll ? content.split(operation.oldString).join(operation.newString) : content.replace(operation.oldString, () => operation.newString);
    } else content = operation.content;
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    if (data.length > limits.outputBytes) throw new Error("File content exceeds the 64 MiB output limit.");
    check(); native.stage(transaction, `.ringko-write-${randomUUID()}.tmp`);
    for (let offset = 0; offset < data.length; offset += limits.ioChunkBytes) {
      check(); native.write(transaction, data.subarray(offset, Math.min(data.length, offset + limits.ioChunkBytes)));
      if (offset % (limits.ioChunkBytes * 16) === 0) await yieldNow();
    }
    native.flush(transaction); await commitAllowed();
    const info = native.commit(transaction);
    outcome = { ok: true, result: { bytes: data.length, size: info.size, mtimeMs: info.mtimeMs, created: !original.exists, replacements, identity: info.identity } };
  } catch (error) {
    outcome = { ok: false, error: error.message, code: error.code };
    if (transaction) {
      const status = native.status(transaction);
      if (status.committed) { outcome.committed = true; if (status.identity) outcome.result = { ...status, bytes: status.size, created: !original?.exists, replacements }; }
    }
  } finally {
    if (transaction) {
      try { native.close(transaction); }
      catch (error) {
        outcome = { ...outcome, ok: false, error: `${outcome?.error ?? (outcome?.ok ? "File committed" : "File operation failed")}; native cleanup failed: ${error.message}`, committed: outcome?.ok || outcome?.committed };
      }
    }
    parentPort.postMessage(outcome);
  }
}
void run();
