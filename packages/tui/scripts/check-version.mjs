import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "../../..");
const manifest = JSON.parse(readFileSync(resolve(root, "packages/tui/package.json"), "utf8"));
const lock = ts.parseConfigFileTextToJson("bun.lock", readFileSync(resolve(root, "bun.lock"), "utf8"));
if (lock.error) throw new Error(ts.flattenDiagnosticMessageText(lock.error.messageText, "\n"));
assert.equal(lock.config?.workspaces?.["packages/tui"]?.version, manifest.version, "CLI manifest and bun.lock versions must match");
console.log(`Verified CLI version ${manifest.version} matches bun.lock.`);
