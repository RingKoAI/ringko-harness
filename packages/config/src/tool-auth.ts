// Tool/connector credentials at `~/.ringko/tool.auth.json` (mode 0600).
//
// Separate from provider credentials (`auth.json`). Keyed by tool/connector id
// (usually an MCP server name). OAuth entries carry rotating tokens plus the
// token endpoint / client registration needed to refresh; API-key and
// raw-header entries cover the other auth shapes.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { toolAuthPath } from "./paths.ts";

export interface ToolOAuthCredential {
  type: "oauth";
  access: string;
  /** Absent when the server issued no refresh token. */
  refresh?: string;
  /** Epoch milliseconds when `access` expires. */
  expires: number;
  /** Token endpoint used to refresh. */
  tokenEndpoint?: string;
  /** Dynamically registered (or fixed) client id. */
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  /** Protected resource the token is bound to. */
  resource?: string;
}

export interface ToolApiCredential {
  type: "apikey";
  key: string;
}

/** Literal headers, e.g. a custom `Authorization` scheme. */
export interface ToolHeadersCredential {
  type: "headers";
  headers: Record<string, string>;
}

export type ToolAuthInfo = ToolOAuthCredential | ToolApiCredential | ToolHeadersCredential;
export type ToolAuthStore = Record<string, ToolAuthInfo>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInfo(value: unknown): ToolAuthInfo | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "oauth") {
    if (typeof value.access !== "string" || typeof value.expires !== "number") return undefined;
    return {
      type: "oauth",
      access: value.access,
      expires: value.expires,
      ...(typeof value.refresh === "string" ? { refresh: value.refresh } : {}),
      ...(typeof value.tokenEndpoint === "string" ? { tokenEndpoint: value.tokenEndpoint } : {}),
      ...(typeof value.clientId === "string" ? { clientId: value.clientId } : {}),
      ...(typeof value.clientSecret === "string" ? { clientSecret: value.clientSecret } : {}),
      ...(Array.isArray(value.scopes) && value.scopes.every((item) => typeof item === "string")
        ? { scopes: value.scopes as string[] }
        : {}),
      ...(typeof value.resource === "string" ? { resource: value.resource } : {}),
    };
  }
  if (value.type === "apikey" && typeof value.key === "string") {
    return { type: "apikey", key: value.key };
  }
  if (value.type === "headers" && isRecord(value.headers)) {
    const headers: Record<string, string> = {};
    for (const [key, item] of Object.entries(value.headers)) {
      if (typeof item === "string") headers[key] = item;
    }
    return { type: "headers", headers };
  }
  return undefined;
}

/** Read all tool credentials; a missing file yields `{}`. */
export function loadToolAuth(env: NodeJS.ProcessEnv = process.env): ToolAuthStore {
  let text: string;
  try {
    text = readFileSync(toolAuthPath(env), "utf8");
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
  const store: ToolAuthStore = {};
  for (const [key, value] of Object.entries(parsed)) {
    const info = parseInfo(value);
    if (info) store[key] = info;
  }
  return store;
}

function writeStore(store: ToolAuthStore, env: NodeJS.ProcessEnv): void {
  const path = toolAuthPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
}

export function getToolAuth(id: string, env: NodeJS.ProcessEnv = process.env): ToolAuthInfo | undefined {
  return loadToolAuth(env)[id];
}

export function setToolAuth(id: string, info: ToolAuthInfo, env: NodeJS.ProcessEnv = process.env): void {
  const store = loadToolAuth(env);
  store[id] = info;
  writeStore(store, env);
}

export function removeToolAuth(id: string, env: NodeJS.ProcessEnv = process.env): void {
  const store = loadToolAuth(env);
  delete store[id];
  writeStore(store, env);
}
