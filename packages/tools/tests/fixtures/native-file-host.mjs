import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const native = createRequire(import.meta.url)(process.argv[2]);
if (process.argv[4] === "lock") {
  const transaction = native.begin(join(process.argv[3], "coordination.lock"), "lock", false);
  process.stdin.resume();
  process.stdin.once("end", () => { native.close(transaction); });
  console.log("Node-API lock held.");
} else {
  const path = join(process.argv[3], "node-host.txt");
  const transaction = native.begin(path, "write", true);
  try {
    native.stage(transaction, ".ringko-write-node-host.tmp");
    native.write(transaction, Buffer.from("node-api-host"));
    native.flush(transaction);
    assert.equal(native.commit(transaction).size, 13);
  } finally { native.close(transaction); }
  assert.equal(readFileSync(path, "utf8"), "node-api-host");
  console.log("Node-API host verified.");
}
