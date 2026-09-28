// OpenAI (ChatGPT) OAuth login, mirroring the opencode/Codex flow:
// loopback server on a fixed port with PKCE (browser) or the device-code flow.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { applyProxyEnv, type OAuthCredential } from "@ringko-ai/config";
import { CODEX_ORIGINATOR, codexUserAgent } from "./codex.ts";
import { OAUTH_CALLBACK_HEADERS, renderOAuthCallbackPage, type OAuthFailure } from "./callback-page.ts";

export const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_ISSUER = "https://auth.openai.com";
export const OPENAI_CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex";
export const OPENAI_OAUTH_PORT = 1455;
export const OPENAI_REDIRECT_URI = `http://localhost:${OPENAI_OAUTH_PORT}/auth/callback`;
// Matches the Codex CLI's requested scopes (see `codex-rs/login/src/server.rs`).
export const OPENAI_SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke";

const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
export interface Pkce {
  verifier: string;
  challenge: string;
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce(): Pkce {
  const bytes = randomBytes(43);
  let verifier = "";
  for (const byte of bytes) verifier += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64Url(randomBytes(32));
}

export function buildAuthorizeUrl(challenge: string, state: string, redirectUri = OPENAI_REDIRECT_URI): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OPENAI_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: CODEX_ORIGINATOR,
  });
  return `${OPENAI_ISSUER}/oauth/authorize?${params.toString()}`;
}

/** Headers the Codex CLI sends on auth/device endpoints. */
function codexAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return { "User-Agent": codexUserAgent(env), originator: CODEX_ORIGINATOR };
}

function decodeJwt(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Extract the ChatGPT account id from the id/access token claims. */
export function extractAccountId(idToken?: string, accessToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    const claims = decodeJwt(token);
    if (!claims) continue;
    const direct = claims.chatgpt_account_id;
    if (typeof direct === "string" && direct.length > 0) return direct;
    const auth = claims["https://api.openai.com/auth"];
    if (typeof auth === "object" && auth !== null) {
      const nested = (auth as Record<string, unknown>).chatgpt_account_id;
      if (typeof nested === "string" && nested.length > 0) return nested;
    }
    const organizations = claims.organizations;
    if (Array.isArray(organizations) && organizations.length > 0) {
      const first = organizations[0];
      if (typeof first === "object" && first !== null) {
        const id = (first as Record<string, unknown>).id;
        if (typeof id === "string" && id.length > 0) return id;
      }
    }
  }
  return undefined;
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

function toCredential(tokens: TokenResponse, fallbackRefresh?: string): OAuthCredential {
  const refresh = tokens.refresh_token ?? fallbackRefresh;
  if (!tokens.access_token || !refresh) throw new Error("OAuth token response was missing tokens.");
  const accountId = extractAccountId(tokens.id_token, tokens.access_token);
  return {
    type: "oauth",
    refresh,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...(accountId ? { accountId } : {}),
  };
}

function regionBlockHint(status: number, body: string): string {
  if (status === 403 && body.includes("unsupported_country_region_territory")) {
    return ' — OpenAI blocked this region for the server IP. Set RINGKO_PROXY (or HTTPS_PROXY), e.g. "http://127.0.0.1:7890", and retry.';
  }
  return "";
}

async function postForm(url: string, form: Record<string, string>): Promise<TokenResponse> {
  applyProxyEnv();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...codexAuthHeaders() },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OAuth request failed: ${response.status}${regionBlockHint(response.status, body)} ${body.slice(0, 200)}`);
  }
  return (await response.json()) as TokenResponse;
}

export function exchangeCode(code: string, verifier: string, redirectUri = OPENAI_REDIRECT_URI): Promise<OAuthCredential> {
  return postForm(`${OPENAI_ISSUER}/oauth/token`, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: OPENAI_CLIENT_ID,
    code_verifier: verifier,
  }).then((tokens) => toCredential(tokens));
}

export function refreshOpenAi(refresh: string): Promise<OAuthCredential> {
  return postForm(`${OPENAI_ISSUER}/oauth/token`, {
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: OPENAI_CLIENT_ID,
  }).then((tokens) => toCredential(tokens, refresh));
}

/** Browser flow: open the authorize URL and wait for the loopback callback. */
export async function loginOpenAiBrowser(onUrl: (url: string) => void): Promise<OAuthCredential> {
  const pkce = generatePkce();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl(pkce.challenge, state);

  return new Promise<OAuthCredential>((resolve, reject) => {
    let settled = false;
    let exchanging = false;
    let exchangeResponse: import("node:http").ServerResponse | undefined;
    const finish = (error?: Error, credential?: OAuthCredential): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (server.listening) server.close();
      if (error) reject(error);
      else if (credential) resolve(credential);
    };
    const fail = (response: import("node:http").ServerResponse, status: number, reason: OAuthFailure, error: Error): void => {
      response.writeHead(status, OAUTH_CALLBACK_HEADERS);
      response.end(renderOAuthCallbackPage("OpenAI", { status: "error", reason }));
      finish(error);
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${OPENAI_OAUTH_PORT}`);
      if (url.pathname !== "/auth/callback") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (settled || exchanging) {
        response.writeHead(409, OAUTH_CALLBACK_HEADERS);
        response.end(renderOAuthCallbackPage("OpenAI", { status: "error", reason: "invalid-state" }));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        fail(response, 400, "invalid-state", new Error("OAuth state mismatch."));
        return;
      }
      if (url.searchParams.has("error")) {
        fail(response, 400, "denied", new Error("OAuth authorization was denied or cancelled."));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        fail(response, 400, "missing-code", new Error("OAuth authorization code is missing."));
        return;
      }
      exchanging = true;
      exchangeResponse = response;
      exchangeCode(code, pkce.verifier)
        .then((credential) => {
          if (settled) return;
          response.writeHead(200, OAUTH_CALLBACK_HEADERS);
          response.end(renderOAuthCallbackPage("OpenAI", { status: "success" }));
          finish(undefined, credential);
        })
        .catch((error: unknown) => {
          if (settled) return;
          fail(response, 502, "token-exchange", error instanceof Error ? error : new Error(String(error)));
        });
    });
    server.on("error", (error) => finish(error));
    server.listen(OPENAI_OAUTH_PORT, "localhost", () => onUrl(authorizeUrl));
    const timeout = setTimeout(
      () => {
        const error = new Error("OAuth login timed out.");
        if (exchangeResponse && !exchangeResponse.headersSent) fail(exchangeResponse, 504, "timed-out", error);
        else finish(error);
      },
      5 * 60 * 1000,
    );
    timeout.unref?.();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Device-code flow (headless); `onCode` receives the verification URL and code. */
export async function loginOpenAiDevice(onCode: (url: string, code: string) => void): Promise<OAuthCredential> {
  applyProxyEnv();
  const startResponse = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "content-type": "application/json", ...codexAuthHeaders() },
    body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
  });
  if (!startResponse.ok) throw new Error(`Device auth failed: ${startResponse.status}`);
  const start = (await startResponse.json()) as { device_auth_id?: string; user_code?: string; interval?: number };
  if (!start.device_auth_id || !start.user_code) throw new Error("Device auth response was incomplete.");
  onCode("https://auth.openai.com/codex/device", start.user_code);

  const interval = Math.max(1, start.interval ?? 5);
  for (;;) {
    await sleep(interval * 1000 + 3000);
    const poll = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", ...codexAuthHeaders() },
      body: JSON.stringify({ device_auth_id: start.device_auth_id, user_code: start.user_code }),
    });
    if (poll.status === 403 || poll.status === 404) continue;
    if (!poll.ok) throw new Error(`Device auth polling failed: ${poll.status}`);
    const data = (await poll.json()) as { authorization_code?: string; code_verifier?: string };
    if (!data.authorization_code || !data.code_verifier) throw new Error("Device auth polling response was incomplete.");
    return exchangeCode(data.authorization_code, data.code_verifier, `${OPENAI_ISSUER}/deviceauth/callback`);
  }
}
