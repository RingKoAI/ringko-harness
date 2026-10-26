import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ringkoRoot } from "./paths.ts";

export const BACKEND_REGISTRY_VERSION = 1;
export const DEFAULT_BACKEND_PORT = 8787;
const MAX_REGISTRATION_BYTES = 16 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface BackendRegistration {
  version: number;
  workspace: string;
  configPath: string | null;
  url: string;
  port: number;
  pid: number;
  instance: string;
  startedAt: number;
}

function canonical(value: string): string {
  const resolved = resolve(value);
  try {
    // realpathSync keeps symlinked workspaces on one registry key.
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function normalized(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

/** Stable key for a workspace/config pair; the same key selects one backend owner. */
export function backendKey(workspace: string, configPath?: string): string {
  const config = configPath ? normalized(canonical(configPath)) : "";
  return createHash("sha256").update(`${normalized(canonical(workspace))}\0${config}`).digest("hex");
}

export function backendRegistrationPath(workspace: string, configPath?: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), "backends", `${backendKey(workspace, configPath)}.json`);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Validate a loopback origin before using a registration to connect. */
export function localBackendOrigin(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return undefined;
  if (!url.port || !/^\d+$/.test(url.port)) return undefined;
  return url.origin;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parse(value: unknown, workspace: string, configPath: string | null): BackendRegistration | undefined {
  const data = record(value);
  if (!data) return undefined;
  if (data.version !== BACKEND_REGISTRY_VERSION) return undefined;
  if (typeof data.workspace !== "string" || normalized(canonical(data.workspace)) !== normalized(canonical(workspace))) return undefined;
  const storedConfig = typeof data.configPath === "string" ? canonical(data.configPath) : null;
  if ((storedConfig === null) !== (configPath === null)) return undefined;
  if (storedConfig !== null && configPath !== null && normalized(storedConfig) !== normalized(canonical(configPath))) return undefined;
  if (typeof data.url !== "string") return undefined;
  const origin = localBackendOrigin(data.url);
  if (!origin) return undefined;
  if (typeof data.port !== "number" || !Number.isInteger(data.port) || data.port < 1 || data.port > 65_535) return undefined;
  if (new URL(origin).port !== String(data.port)) return undefined;
  if (typeof data.pid !== "number" || !Number.isInteger(data.pid) || data.pid <= 0) return undefined;
  if (typeof data.startedAt !== "number" || !Number.isFinite(data.startedAt)) return undefined;
  if (typeof data.instance !== "string" || data.instance.length === 0 || data.instance.length > 128) return undefined;
  return {
    version: BACKEND_REGISTRY_VERSION,
    workspace: canonical(workspace),
    configPath: configPath ? canonical(configPath) : null,
    url: origin,
    port: data.port,
    pid: data.pid,
    instance: data.instance,
    startedAt: data.startedAt,
  };
}

function read(path: string, workspace: string, configPath: string | null): BackendRegistration | undefined {
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { return undefined; }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_REGISTRATION_BYTES) return undefined;
    const buffer = Buffer.alloc(stat.size);
    let total = 0;
    while (total < stat.size) {
      const count = readSync(descriptor, buffer, total, stat.size - total, total);
      if (!count) break;
      total += count;
    }
    return parse(JSON.parse(buffer.subarray(0, total).toString("utf8")), workspace, configPath);
  } catch {
    return undefined;
  } finally { closeSync(descriptor); }
}

/** Read a live owner; a dead PID or invalid record removes the stale registration. */
export function readBackendRegistration(workspace: string, configPath?: string, env: NodeJS.ProcessEnv = process.env): BackendRegistration | undefined {
  const resolvedConfig = configPath ? canonical(configPath) : null;
  const path = backendRegistrationPath(workspace, resolvedConfig ?? undefined, env);
  const registration = read(path, workspace, resolvedConfig);
  if (!registration) {
    try { rmSync(path, { force: true }); } catch { /* best effort */ }
    return undefined;
  }
  if (!isProcessAlive(registration.pid)) {
    try { rmSync(path, { force: true }); } catch { /* raced with another reclaim */ }
    return undefined;
  }
  return registration;
}

function serialized(registration: BackendRegistration): string {
  return `${JSON.stringify(registration)}\n`;
}

/**
 * Claim the single-owner record atomically. A live foreign owner is returned as
 * a conflict instead of being overwritten; a dead/corrupt record is reclaimed.
 */
export function claimBackendRegistration(
  input: Omit<BackendRegistration, "version">,
  env: NodeJS.ProcessEnv = process.env,
): { status: "claimed"; path: string } | { status: "conflict"; registration: BackendRegistration } {
  const registration: BackendRegistration = {
    version: BACKEND_REGISTRY_VERSION,
    ...input,
    workspace: canonical(input.workspace),
    configPath: input.configPath ? canonical(input.configPath) : null,
  };
  if (!parse(registration, registration.workspace, registration.configPath)) throw new TypeError("Invalid backend registration.");
  const path = backendRegistrationPath(registration.workspace, registration.configPath ?? undefined, env);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, serialized(registration), { flag: "wx", mode: 0o600 });
      try { chmodSync(path, 0o600); } catch { /* Windows */ }
      return { status: "claimed", path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = read(path, registration.workspace, registration.configPath);
      if (existing && existing.instance !== registration.instance && isProcessAlive(existing.pid)) {
        return { status: "conflict", registration: existing };
      }
      // Stale, corrupt, or our own previous claim from this instance.
      try { rmSync(path, { force: true }); } catch { /* raced with another reclaim */ }
    }
  }
  // A competing live owner won the reclaim race.
  const existing = read(path, registration.workspace, registration.configPath);
  if (existing) return { status: "conflict", registration: existing };
  throw new Error("Could not claim backend ownership.");
}

/** Atomically replace the owner record (used after the ownership claim succeeds). */
export function writeBackendRegistration(input: Omit<BackendRegistration, "version">, env: NodeJS.ProcessEnv = process.env): string {
  const registration: BackendRegistration = {
    version: BACKEND_REGISTRY_VERSION,
    ...input,
    workspace: canonical(input.workspace),
    configPath: input.configPath ? canonical(input.configPath) : null,
  };
  if (!parse(registration, registration.workspace, registration.configPath)) throw new TypeError("Invalid backend registration.");
  const path = backendRegistrationPath(registration.workspace, registration.configPath ?? undefined, env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, serialized(registration), { flag: "wx", mode: 0o600 });
    try { chmodSync(temporary, 0o600); } catch { /* Windows */ }
    try { renameSync(temporary, path); }
    catch (error) {
      if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      rmSync(path, { force: true });
      renameSync(temporary, path);
    }
    return path;
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

/** Remove the record only when it still belongs to this instance. */
export function removeBackendRegistration(workspace: string, configPath: string | undefined, instance: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const resolvedConfig = configPath ? canonical(configPath) : null;
  const path = backendRegistrationPath(workspace, resolvedConfig ?? undefined, env);
  const registration = read(path, workspace, resolvedConfig);
  if (!registration || registration.instance !== instance) return false;
  try { rmSync(path, { force: true }); return true; }
  catch { return false; }
}
