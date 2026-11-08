import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ringkoRoot } from "@ringko-ai/config";
import { acquireLock } from "@ringko-ai/session";
import type { CliIo, ParsedArgs } from "../cli/types.ts";
import { VERSION } from "../version.ts";
import { checkForUpdate } from "./download.ts";
import { detectInstallation, installNpm, installStandalone, type Installation } from "./install.ts";
import { UPDATE_RELEASES, updatePolicy } from "./policy.ts";

export interface UpdateServices {
  check: typeof checkForUpdate;
  detect: () => Promise<Installation>;
  install: (version: string, installation: Installation, io: CliIo) => Promise<void>;
}
const services: UpdateServices = {
  check: checkForUpdate,
  detect: detectInstallation,
  async install(version, installation, io) {
    if (installation.kind === "source") throw new Error(`Source checkouts are not self-updated. Pull the desired release and rebuild, or download it from ${UPDATE_RELEASES}.`);
    mkdirSync(ringkoRoot(), { recursive: true, mode: 0o700 });
    const lock = acquireLock(join(ringkoRoot(), "update.lock"));
    try {
      if (installation.kind === "npm") await installNpm(version, installation.packageRoot);
      else await installStandalone(version, installation.executable, { warn: io.err });
    } finally { lock.release(); }
  },
};

export async function updateCommand(parsed: ParsedArgs, io: CliIo, deps = services): Promise<number> {
  if (parsed.positionals.some(arg => arg !== "--check") || parsed.positionals.length > 1) { io.err("Usage: ringko update [--check]"); return 2; }
  try {
    const result = await deps.check(VERSION);
    if (!result.available) { io.out(`RingKo ${VERSION} is up to date (latest stable: ${result.latest}).`); return 0; }
    io.out(`RingKo update available: ${VERSION} -> ${result.latest}`);
    if (parsed.positionals.includes("--check")) { io.out("Run ringko update to install it."); return 0; }
    await deps.install(result.latest, await deps.detect(), io);
    io.out(`Updated to ${result.latest}. Restart RingKo and its shared backend to use the new version.`);
    return 0;
  } catch (error) { io.err(error instanceof Error ? error.message : "Update failed."); return 1; }
}

/** Called by the executable, not embedded runCli hosts or backend workers. */
export async function startupUpdate(parsed: ParsedArgs, io: CliIo, deps = services): Promise<boolean> {
  if (parsed.command === undefined && !process.stdin.isTTY) return false;
  if (![undefined, "tui", "web", "run", "loop", "service"].includes(parsed.command) || (parsed.command === "service" && parsed.positionals[0] !== "start")) return false;
  try {
    const policy = updatePolicy(loadConfig({ path: parsed.config }), io.err);
    if (!policy.checkOnStartup) return false;
    const result = await deps.check(VERSION);
    if (!result.available) return false;
    io.err(`RingKo update available: ${VERSION} -> ${result.latest}. Run ringko update to install.`);
    if (!policy.autoUpdate) return false;
    const installation = await deps.detect();
    if (installation.kind === "source") { io.err("Source checkout detected; automatic installation is skipped. Pull and rebuild to update."); return false; }
    await deps.install(result.latest, installation, io);
    io.err(`Updated to ${result.latest}. Restart RingKo and its shared backend to use the new version.`);
    return true;
  } catch (error) {
    io.err(`Startup update skipped: ${error instanceof Error ? error.message : "update check failed"}`);
    return false;
  }
}
