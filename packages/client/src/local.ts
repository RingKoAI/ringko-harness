import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const SERVICE_PORT_BASE = 22_000;
export const SERVICE_PORT_RANGE = 20_000;
export function canonicalWorkspace(workspace: string): string { return realpathSync(resolve(workspace)); }
export function sharedPort(workspace: string, configPath?: string): number {
  const path = canonicalWorkspace(workspace);
  const normalized = process.platform === "win32" ? path.toLowerCase() : path;
  const config = configPath ? resolve(configPath) : "";
  const key = `${normalized}\0${process.platform === "win32" ? config.toLowerCase() : config}`;
  return SERVICE_PORT_BASE + createHash("sha256").update(key).digest().readUInt32BE(0) % SERVICE_PORT_RANGE;
}
