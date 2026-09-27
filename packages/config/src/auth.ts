// Provider credentials at `~/.ringko/auth/auth.json` (mode 0600).
//
// Shape: `Record<providerId, AuthInfo>`. OAuth entries carry rotating tokens;
// API entries carry a static key.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { authPath } from "./paths.ts";

export interface OAuthCredential {
  type: "oauth";
  refresh: string;
  access: string;
  /** Epoch milliseconds when `access` expires. */
  expires: number;
  accountId?: string;
}

export interface ApiCredential {
  type: "apikey";
  key: string;
}

export type AuthInfo = OAuthCredential | ApiCredential;
export type AuthStore = Record<string, AuthInfo>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInfo(value: unknown): AuthInfo | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "oauth") {
    if (typeof value.refresh !== "string" || typeof value.access !== "string" || typeof value.expires !== "number") {
      return undefined;
    }
    return {
      type: "oauth",
      refresh: value.refresh,
      access: value.access,
      expires: value.expires,
      ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    };
  }
  // `api` is accepted as a legacy alias of `apikey`.
  if (value.type === "apikey" || value.type === "api") {
    if (typeof value.key !== "string") return undefined;
    return { type: "apikey", key: value.key };
  }
  return undefined;
}

/** Read all credentials; a missing file yields `{}`, invalid entries are dropped. */
export function loadAuth(env: NodeJS.ProcessEnv = process.env): AuthStore {
  let text: string;
  try {
    text = readFileSync(authPath(env), "utf8");
  } catch {
    return {};
  }
  if (text.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const store: AuthStore = {};
  for (const [key, value] of Object.entries(parsed)) {
    const info = parseInfo(value);
    if (info) store[key] = info;
  }
  return store;
}

function writeStore(store: AuthStore, env: NodeJS.ProcessEnv): void {
  const path = authPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
}

export function getAuth(providerId: string, env: NodeJS.ProcessEnv = process.env): AuthInfo | undefined {
  return loadAuth(env)[providerId];
}

/**
 * The stored API key for a provider (an `apikey` credential in auth.json).
 * OAuth credentials are not API keys; use {@link getAuth} for those.
 */
export function getApiKey(providerId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const info = getAuth(providerId, env);
  return info?.type === "apikey" ? info.key : undefined;
}

export function setAuth(providerId: string, info: AuthInfo, env: NodeJS.ProcessEnv = process.env): void {
  const store = loadAuth(env);
  store[providerId] = info;
  writeStore(store, env);
}

export function removeAuth(providerId: string, env: NodeJS.ProcessEnv = process.env): void {
  const store = loadAuth(env);
  delete store[providerId];
  writeStore(store, env);
}
