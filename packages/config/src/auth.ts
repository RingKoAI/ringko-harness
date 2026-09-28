// Provider credentials at `~/.ringko/auth/auth.json` (mode 0600).
//
// OAuth credentials are grouped into auth domains (`openai-oauth`,
// `github-copilot`, ...). Each domain holds one or more accounts and names a
// default account. Static API keys stay keyed by provider id.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { authPath } from "./paths.ts";

/** OAuth auth domains the harness knows how to sign in to. */
export const OAUTH_DOMAINS = ["openai-oauth", "github-copilot", "xai-oauth", "anthropic-oauth", "google-gemini-cli"] as const;
export type OAuthDomainId = (typeof OAUTH_DOMAINS)[number];

export interface OAuthCredential {
  type: "oauth";
  refresh: string;
  access: string;
  /** Epoch milliseconds when `access` expires. */
  expires: number;
  accountId?: string;
  /** Google Code Assist project, distinct from the account identity. */
  projectId?: string;
  /** Display identity (email or username) reported by the login flow. */
  login?: string;
  avatarUrl?: string;
}

export interface ApiCredential {
  type: "apikey";
  key: string;
}

export type AuthInfo = OAuthCredential | ApiCredential;

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
  defaultAccountId?: string;
  accounts: OAuthAccount[];
}

export interface AuthState {
  oauth: Record<string, OAuthDomain>;
  apikeys: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyState(): AuthState {
  return { oauth: {}, apikeys: {} };
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
    ...(typeof value.projectId === "string" ? { projectId: value.projectId } : {}),
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

/** Migrate the legacy `Record<providerId, AuthInfo>` shape into {@link AuthState}. */
function migrateLegacy(parsed: Record<string, unknown>): AuthState {
  const state = emptyState();
  for (const [id, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    if (value.type === "apikey" || value.type === "api") {
      if (typeof value.key === "string") state.apikeys[id] = value.key;
      continue;
    }
    const credential = parseOAuthCredential(value);
    if (!credential) continue;
    const domain = legacyDomain(id);
    const accountId = credential.accountId ?? credential.login ?? id;
    const domainState = (state.oauth[domain] ??= { accounts: [] });
    domainState.accounts.push({ id: accountId, credential, authenticatedAt: Date.now() });
    domainState.defaultAccountId ??= accountId;
  }
  return state;
}

/** Read the credential store; a missing or corrupt file yields an empty state. */
export function loadAuth(env: NodeJS.ProcessEnv = process.env): AuthState {
  let text: string;
  try {
    text = readFileSync(authPath(env), "utf8");
  } catch {
    return emptyState();
  }
  if (text.trim().length === 0) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyState();
  }
  if (!isRecord(parsed)) return emptyState();
  if (!isRecord(parsed.oauth) && !isRecord(parsed.apikeys)) return migrateLegacy(parsed);

  const state = emptyState();
  if (isRecord(parsed.apikeys)) {
    for (const [id, key] of Object.entries(parsed.apikeys)) {
      if (typeof key === "string") state.apikeys[id] = key;
    }
  }
  if (isRecord(parsed.oauth)) {
    for (const [domain, value] of Object.entries(parsed.oauth)) {
      if (!isRecord(value)) continue;
      const accounts = Array.isArray(value.accounts)
        ? value.accounts.map(parseAccount).filter((account): account is OAuthAccount => account !== undefined)
        : [];
      if (accounts.length === 0) continue;
      const defaultAccountId = typeof value.defaultAccountId === "string"
        && accounts.some((account) => account.id === value.defaultAccountId)
        ? value.defaultAccountId
        : accounts[0].id;
      state.oauth[domain] = { defaultAccountId, accounts };
    }
  }
  return state;
}

function writeState(state: AuthState, env: NodeJS.ProcessEnv): void {
  const path = authPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
}

export function saveAuth(state: AuthState, env: NodeJS.ProcessEnv = process.env): void {
  writeState(state, env);
}

// --- API keys ---------------------------------------------------------------

export function getApiKey(providerId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return loadAuth(env).apikeys[providerId];
}

export function setApiKey(providerId: string, key: string, env: NodeJS.ProcessEnv = process.env): void {
  const state = loadAuth(env);
  state.apikeys[providerId] = key;
  writeState(state, env);
}

export function removeApiKey(providerId: string, env: NodeJS.ProcessEnv = process.env): void {
  const state = loadAuth(env);
  delete state.apikeys[providerId];
  writeState(state, env);
}

// --- OAuth domains ----------------------------------------------------------

export function getOAuthDomain(domain: string, env: NodeJS.ProcessEnv = process.env): OAuthDomain {
  return loadAuth(env).oauth[domain] ?? { accounts: [] };
}

/** Match an account by its uuid first, then by its provider id. */
function matchAccount(account: OAuthAccount, key: string): boolean {
  return account.uuid === key || account.id === key;
}

/** The requested account, or the domain's default account. */
export function getOAuthAccount(
  domain: string,
  accountId?: string,
  env: NodeJS.ProcessEnv = process.env,
): OAuthAccount | undefined {
  const state = getOAuthDomain(domain, env);
  if (accountId !== undefined) return state.accounts.find((account) => matchAccount(account, accountId));
  const fallback = state.defaultAccountId ?? state.accounts[0]?.id;
  return fallback === undefined ? undefined : state.accounts.find((account) => matchAccount(account, fallback));
}

/** Insert or replace an account; the first account becomes the default. */
export function setOAuthAccount(domain: string, account: OAuthAccount, env: NodeJS.ProcessEnv = process.env): void {
  const state = loadAuth(env);
  const domainState = (state.oauth[domain] ??= { accounts: [] });
  const index = domainState.accounts.findIndex((entry) => entry.id === account.id);
  if (index === -1) domainState.accounts.push({ ...account, uuid: account.uuid ?? randomUUID() });
  // Re-signing in keeps the existing uuid so switches stay stable.
  else domainState.accounts[index] = { ...account, uuid: domainState.accounts[index].uuid ?? account.uuid ?? randomUUID() };
  domainState.defaultAccountId ??= account.id;
  writeState(state, env);
}

export function removeOAuthAccount(domain: string, key: string, env: NodeJS.ProcessEnv = process.env): void {
  const state = loadAuth(env);
  const domainState = state.oauth[domain];
  if (!domainState) return;
  const account = domainState.accounts.find((entry) => matchAccount(entry, key));
  if (!account) return;
  domainState.accounts = domainState.accounts.filter((entry) => entry !== account);
  if (domainState.accounts.length === 0) {
    delete state.oauth[domain];
  } else if (domainState.defaultAccountId === account.id) {
    domainState.defaultAccountId = domainState.accounts[0].id;
  }
  writeState(state, env);
}

export function setDefaultOAuthAccount(domain: string, key: string, env: NodeJS.ProcessEnv = process.env): void {
  const state = loadAuth(env);
  const domainState = state.oauth[domain];
  if (!domainState) return;
  const account = domainState.accounts.find((entry) => matchAccount(entry, key));
  if (!account) return;
  domainState.defaultAccountId = account.id;
  writeState(state, env);
}

/** Replace an account's rotating tokens after a refresh. */
export function updateOAuthCredential(
  domain: string,
  accountId: string,
  credential: OAuthCredential,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const state = loadAuth(env);
  const domainState = state.oauth[domain];
  if (!domainState) return;
  const account = domainState.accounts.find((entry) => matchAccount(entry, accountId));
  if (!account) return;
  account.credential = credential;
  writeState(state, env);
}
