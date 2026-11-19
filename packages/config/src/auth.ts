// Provider credentials at `~/.ringko/auth/auth.json` (mode 0600).
//
// Every persisted credential carries an explicit `type` discriminator:
// - `"oauth"` for OAuth domains & accounts (`openai-oauth`, `github-copilot`, ...)
// - `"key"` for API key entries, carrying `providerName`, `providerType`, `key`, and optional `keys` rotation pool.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { splitStoredApiKeys } from "./key-roulette.ts";
import { authPath } from "./paths.ts";
import { findProviderPreset } from "./presets.ts";
import { isRecord } from "./util.ts";

/** OAuth auth domains the harness knows how to sign in to. */
export const OAUTH_DOMAINS = ["openai-oauth", "github-copilot", "xai-oauth", "anthropic-oauth"] as const;
export type OAuthDomainId = (typeof OAUTH_DOMAINS)[number];

export interface OAuthCredential {
  type: "oauth";
  refresh: string;
  access: string;
  /** Epoch milliseconds when `access` expires. */
  expires: number;
  accountId?: string;
  /** Display identity (email or username) reported by the login flow. */
  login?: string;
  avatarUrl?: string;
}

export interface ApiCredential {
  type: "key" | "apikey";
  providerName?: string;
  providerType?: string;
  key: string;
  keys?: string[];
}

export type AuthInfo = OAuthCredential | ApiCredential;

export interface KeyCredentialEntry {
  type: "key";
  /** Configured provider name (e.g. "deepseek", "openai"). */
  providerName: string;
  /** Protocol adapter type (e.g. "openai-compatible", "openai", "anthropic", "google"). */
  providerType: string;
  /** Primary API key. */
  key: string;
  /** Optional multi-key pool rotated via KeyRoulette when 2+ keys are configured. */
  keys?: string[];
}

export interface SetApiKeyOptions {
  providerName?: string;
  providerType?: string;
}

export interface OAuthAccount {
  /** Stable account uuid used to switch/select the account. */
  uuid?: string;
  /** Provider-native account id (accountId / login). */
  id: string;
  credential: OAuthCredential;
  /** Epoch milliseconds when this account was last signed in. */
  authenticatedAt: number;
}

export interface OAuthDomain {
  type?: "oauth";
  defaultAccountId?: string;
  accounts: OAuthAccount[];
}

export interface AuthState {
  oauth: Record<string, OAuthDomain>;
  apikeys: Record<string, string>;
}

interface InternalAuthStore {
  oauth: Record<string, OAuthDomain>;
  keyEntries: Record<string, KeyCredentialEntry>;
}

function defaultProviderTypeFor(providerId: string): string {
  return findProviderPreset(providerId)?.type ?? "openai-compatible";
}

function buildKeyEntry(
  providerId: string,
  rawKeys: readonly string[],
  options: SetApiKeyOptions = {},
): KeyCredentialEntry | undefined {
  const cleaned = rawKeys.filter(item => typeof item === "string" && item.length > 0);
  if (cleaned.length === 0) return undefined;
  const providerName = options.providerName?.trim() || providerId;
  const providerType = options.providerType?.trim() || defaultProviderTypeFor(providerName);
  return {
    type: "key",
    providerName,
    providerType,
    key: cleaned[0]!,
    ...(cleaned.length > 1 ? { keys: [...cleaned] } : {}),
  };
}

function parseKeyEntry(providerId: string, value: unknown): KeyCredentialEntry | undefined {
  if (typeof value === "string") {
    if (value.length === 0) return undefined;
    const split = splitStoredApiKeys(value);
    return buildKeyEntry(providerId, split.length > 0 ? split : [value]);
  }
  if (!isRecord(value)) return undefined;
  if (value.type !== "key" && value.type !== "apikey" && value.type !== "api") return undefined;
  const explicitKeys = Array.isArray(value.keys)
    ? value.keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map(k => k.trim())
    : [];
  const primary = typeof value.key === "string" && value.key.trim().length > 0 ? value.key.trim() : explicitKeys[0];
  if (!primary) return undefined;
  const allKeys = explicitKeys.length > 0
    ? [primary, ...explicitKeys.filter(k => k !== primary)]
    : (() => {
      const split = splitStoredApiKeys(primary);
      return split.length > 0 ? split : [primary];
    })();
  return buildKeyEntry(providerId, allKeys, {
    providerName: typeof value.providerName === "string" ? value.providerName : providerId,
    providerType: typeof value.providerType === "string" ? value.providerType : undefined,
  });
}

function parseOAuthCredential(value: unknown): OAuthCredential | undefined {
  if (!isRecord(value) || value.type !== "oauth") return undefined;
  if (typeof value.refresh !== "string" || typeof value.access !== "string" || typeof value.expires !== "number") {
    return undefined;
  }
  return {
    type: "oauth",
    refresh: value.refresh,
    access: value.access,
    expires: value.expires,
    ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    ...(typeof value.login === "string" ? { login: value.login } : {}),
    ...(typeof value.avatarUrl === "string" ? { avatarUrl: value.avatarUrl } : {}),
  };
}

function parseAccount(value: unknown): OAuthAccount | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const credential = parseOAuthCredential(value.credential);
  if (!credential) return undefined;
  return {
    id: value.id,
    ...(typeof value.uuid === "string" ? { uuid: value.uuid } : {}),
    credential,
    authenticatedAt: typeof value.authenticatedAt === "number" ? value.authenticatedAt : Date.now(),
  };
}

/** Best-effort mapping of a legacy provider id to an OAuth domain. */
function legacyDomain(id: string): string {
  const value = id.toLowerCase();
  if (value.includes("copilot") || value.includes("github")) return "github-copilot";
  if (value.includes("xai") || value.includes("grok")) return "xai-oauth";
  return "openai-oauth";
}

function migrateLegacyStore(parsed: Record<string, unknown>): InternalAuthStore {
  const store: InternalAuthStore = { oauth: {}, keyEntries: {} };
  for (const [id, value] of Object.entries(parsed)) {
    const keyEntry = parseKeyEntry(id, value);
    if (keyEntry) {
      store.keyEntries[id] = keyEntry;
      continue;
    }
    if (!isRecord(value)) continue;
    const credential = parseOAuthCredential(value);
    if (!credential) continue;
    const domain = legacyDomain(id);
    const accountId = credential.accountId ?? credential.login ?? id;
    const domainState = (store.oauth[domain] ??= { accounts: [] });
    domainState.accounts.push({ id: accountId, credential, authenticatedAt: Date.now() });
    domainState.defaultAccountId ??= accountId;
  }
  return store;
}

function readInternalStore(env: NodeJS.ProcessEnv = process.env): InternalAuthStore {
  let text: string;
  try {
    text = readFileSync(authPath(env), "utf8");
  } catch {
    return { oauth: {}, keyEntries: {} };
  }
  if (text.trim().length === 0) return { oauth: {}, keyEntries: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { oauth: {}, keyEntries: {} };
  }
  if (!isRecord(parsed)) return { oauth: {}, keyEntries: {} };
  if (!isRecord(parsed.oauth) && !isRecord(parsed.apikeys)) return migrateLegacyStore(parsed);

  const store: InternalAuthStore = { oauth: {}, keyEntries: {} };
  if (isRecord(parsed.apikeys)) {
    for (const [id, rawEntry] of Object.entries(parsed.apikeys)) {
      const entry = parseKeyEntry(id, rawEntry);
      if (entry) store.keyEntries[id] = entry;
    }
  }
  if (isRecord(parsed.oauth)) {
    for (const [domain, value] of Object.entries(parsed.oauth)) {
      if (!isRecord(value)) continue;
      const accounts = Array.isArray(value.accounts)
        ? value.accounts.map(parseAccount).filter((account): account is OAuthAccount => account !== undefined)
        : [];
      if (accounts.length === 0) continue;
      const defaultAccountId =
        typeof value.defaultAccountId === "string" && accounts.some(account => account.id === value.defaultAccountId)
          ? value.defaultAccountId
          : accounts[0]!.id;
      store.oauth[domain] = { defaultAccountId, accounts };
    }
  }
  return store;
}

function writeInternalStore(store: InternalAuthStore, env: NodeJS.ProcessEnv): void {
  const path = authPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const serializedOauth: Record<string, unknown> = {};
  for (const [domain, entry] of Object.entries(store.oauth)) {
    if (!entry.accounts.length) continue;
    serializedOauth[domain] = {
      type: "oauth",
      ...(entry.defaultAccountId ? { defaultAccountId: entry.defaultAccountId } : {}),
      accounts: entry.accounts,
    };
  }
  const serializedKeys: Record<string, KeyCredentialEntry> = {};
  for (const [id, entry] of Object.entries(store.keyEntries)) {
    serializedKeys[id] = {
      type: "key",
      providerName: entry.providerName,
      providerType: entry.providerType,
      key: entry.key,
      ...(entry.keys && entry.keys.length > 1 ? { keys: entry.keys } : {}),
    };
  }
  const payload = {
    oauth: serializedOauth,
    apikeys: serializedKeys,
  };
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
}

/**
 * Strictly validate an existing `auth.json` file before mutating credentials so
 * corrupt entries are never silently discarded.
 */
export function verifyAuthStoreIntegrity(env: NodeJS.ProcessEnv = process.env): void {
  let rawText: string;
  try {
    rawText = readFileSync(authPath(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("Cannot read credential store.");
  }
  if (rawText.trim().length === 0) return;
  const stored: unknown = JSON.parse(rawText);
  if (!isRecord(stored)) throw new Error("Invalid credential store.");
  if (stored.apikeys !== undefined && !isRecord(stored.apikeys)) throw new Error("Invalid apikeys object.");
  if (stored.oauth !== undefined && !isRecord(stored.oauth)) throw new Error("Invalid oauth object.");

  const loaded = readInternalStore(env);
  const loadedCount =
    Object.keys(loaded.keyEntries).length +
    Object.values(loaded.oauth).reduce((count, domain) => count + domain.accounts.length, 0);

  const expectedCount =
    stored.oauth !== undefined || stored.apikeys !== undefined
      ? Object.keys(stored.apikeys ?? {}).length +
        Object.values(stored.oauth ?? {}).reduce<number>((count, domain) => {
          if (!isRecord(domain) || !Array.isArray(domain.accounts)) throw new Error("Invalid OAuth domain.");
          return count + domain.accounts.length;
        }, 0)
      : Object.keys(stored).length;

  if (loadedCount !== expectedCount) {
    throw new Error("Credential entries could not be preserved.");
  }
}

/** Read the credential store; a missing or corrupt file yields an empty state. */
export function loadAuth(env: NodeJS.ProcessEnv = process.env): AuthState {
  const store = readInternalStore(env);
  const apikeys: Record<string, string> = {};
  for (const [id, entry] of Object.entries(store.keyEntries)) {
    apikeys[id] = entry.key;
  }
  return { oauth: store.oauth, apikeys };
}

/** Read all structured `"key"` credential entries keyed by provider ID. */
export function loadKeyCredentials(env: NodeJS.ProcessEnv = process.env): Record<string, KeyCredentialEntry> {
  return readInternalStore(env).keyEntries;
}

/** Read a single structured `"key"` credential entry. */
export function getKeyCredential(providerId: string, env: NodeJS.ProcessEnv = process.env): KeyCredentialEntry | undefined {
  return readInternalStore(env).keyEntries[providerId];
}

export function saveAuth(state: AuthState, env: NodeJS.ProcessEnv = process.env): void {
  const existing = readInternalStore(env);
  const keyEntries: Record<string, KeyCredentialEntry> = {};
  for (const [id, key] of Object.entries(state.apikeys)) {
    const prev = existing.keyEntries[id];
    const built = buildKeyEntry(id, splitStoredApiKeys(key).length > 0 ? splitStoredApiKeys(key) : [key], {
      providerName: prev?.providerName ?? id,
      providerType: prev?.providerType,
    });
    if (built) keyEntries[id] = built;
  }
  writeInternalStore({ oauth: state.oauth, keyEntries }, env);
}

// --- API keys ---------------------------------------------------------------

export function getApiKey(providerId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readInternalStore(env).keyEntries[providerId]?.key;
}

export function getApiKeys(providerId: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const entry = readInternalStore(env).keyEntries[providerId];
  if (!entry) return [];
  return entry.keys && entry.keys.length > 0 ? [...entry.keys] : [entry.key];
}

export function setApiKey(
  providerId: string,
  key: string | readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  options: SetApiKeyOptions = {},
): void {
  const store = readInternalStore(env);
  const prev = store.keyEntries[providerId];
  const parsedKeys = splitStoredApiKeys(key);
  const rawList =
    parsedKeys.length > 0
      ? parsedKeys
      : typeof key === "string" && key.length > 0
        ? [key]
        : [];
  const entry = buildKeyEntry(providerId, rawList, {
    providerName: options.providerName ?? prev?.providerName ?? providerId,
    providerType: options.providerType ?? prev?.providerType,
  });
  if (entry) store.keyEntries[providerId] = entry;
  else delete store.keyEntries[providerId];
  writeInternalStore(store, env);
}

export function removeApiKey(providerId: string, env: NodeJS.ProcessEnv = process.env): void {
  const store = readInternalStore(env);
  delete store.keyEntries[providerId];
  writeInternalStore(store, env);
}

// --- OAuth domains ----------------------------------------------------------

export function getOAuthDomain(domain: string, env: NodeJS.ProcessEnv = process.env): OAuthDomain {
  return readInternalStore(env).oauth[domain] ?? { accounts: [] };
}

function matchAccount(account: OAuthAccount, key: string): boolean {
  return account.uuid === key || account.id === key;
}

export function getOAuthAccount(
  domain: string,
  accountId?: string,
  env: NodeJS.ProcessEnv = process.env,
): OAuthAccount | undefined {
  const state = getOAuthDomain(domain, env);
  if (accountId !== undefined) return state.accounts.find(account => matchAccount(account, accountId));
  const fallback = state.defaultAccountId ?? state.accounts[0]?.id;
  return fallback === undefined ? undefined : state.accounts.find(account => matchAccount(account, fallback));
}

export function setOAuthAccount(domain: string, account: OAuthAccount, env: NodeJS.ProcessEnv = process.env): void {
  const store = readInternalStore(env);
  const domainState = (store.oauth[domain] ??= { accounts: [] });
  const index = domainState.accounts.findIndex(entry => entry.id === account.id);
  if (index === -1) domainState.accounts.push({ ...account, uuid: account.uuid ?? randomUUID() });
  else domainState.accounts[index] = { ...account, uuid: domainState.accounts[index]!.uuid ?? account.uuid ?? randomUUID() };
  domainState.defaultAccountId ??= account.id;
  writeInternalStore(store, env);
}

export function removeOAuthAccount(domain: string, key: string, env: NodeJS.ProcessEnv = process.env): void {
  const store = readInternalStore(env);
  const domainState = store.oauth[domain];
  if (!domainState) return;
  const account = domainState.accounts.find(entry => matchAccount(entry, key));
  if (!account) return;
  domainState.accounts = domainState.accounts.filter(entry => entry !== account);
  if (domainState.accounts.length === 0) {
    delete store.oauth[domain];
  } else if (domainState.defaultAccountId === account.id) {
    domainState.defaultAccountId = domainState.accounts[0]!.id;
  }
  writeInternalStore(store, env);
}

export function setDefaultOAuthAccount(domain: string, key: string, env: NodeJS.ProcessEnv = process.env): void {
  const store = readInternalStore(env);
  const domainState = store.oauth[domain];
  if (!domainState) return;
  const account = domainState.accounts.find(entry => matchAccount(entry, key));
  if (!account) return;
  domainState.defaultAccountId = account.id;
  writeInternalStore(store, env);
}

export function updateOAuthCredential(
  domain: string,
  accountId: string,
  credential: OAuthCredential,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const store = readInternalStore(env);
  const domainState = store.oauth[domain];
  if (!domainState) return;
  const account = domainState.accounts.find(entry => matchAccount(entry, accountId));
  if (!account) return;
  account.credential = credential;
  writeInternalStore(store, env);
}
