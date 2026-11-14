#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const supported = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]);
const target = `${process.platform}-${process.arch}`;
let child;
try {
  if (!supported.has(target)) throw new Error(`Unsupported platform ${target}. Supported: ${[...supported].join(", ")}.`);
  const name = `@ringko-ai/rkh-${target}`;
  const require = createRequire(import.meta.url);
  let manifestPath;
  try { manifestPath = require.resolve(`${name}/package.json`); }
  catch { throw new Error(`Missing ${name}. Reinstall @ringko-ai/rkh with optional dependencies enabled (npm install -g @ringko-ai/rkh --include=optional).`); }
  const main = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const platform = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (platform.name !== name || platform.version !== main.version) throw new Error(`Platform package version mismatch. Reinstall @ringko-ai/rkh@${main.version}.`);
  const executable = realpathSync(join(dirname(manifestPath), "bin", process.platform === "win32" ? "ringko.exe" : "ringko"));
  child = spawn(executable, process.argv.slice(2), {
    stdio: "inherit", windowsHide: false,
    env: { ...process.env, RINGKO_NPM_ROOT: root, RINGKO_WEBUI_DIR: process.env.RINGKO_WEBUI_DIR ?? join(root, "webui"), RINGKO_TERMINAL_BRIDGE: join(root, "bin", "terminal-bridge.mjs") },
  });
  // The child owns terminal input. Relay external termination without treating
  // Ctrl+C as process exit: the TUI uses it to interrupt/clear a prompt.
  const term = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
  const interrupt = () => { if (!process.stdin.isTTY && child.exitCode === null) child.kill("SIGINT"); };
  process.on("SIGTERM", term); process.on("SIGINT", interrupt);
  child.once("error", error => { console.error(`Cannot start RingKo (${error.code ?? error.message}).`); process.exitCode = 1; });
  child.once("exit", (code, signal) => {
    process.off("SIGTERM", term); process.off("SIGINT", interrupt);
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
