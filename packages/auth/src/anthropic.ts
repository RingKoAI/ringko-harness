// Anthropic OAuth (Claude Pro/Max subscription), mirroring the pi/Claude Code flow.
// Loopback callback + PKCE; the resulting access token is used as an API bearer.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { applyProxyEnv, type OAuthCredential } from "@ringko-ai/config";

export const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const ANTHROPIC_OAUTH_PORT = 53692;
export const ANTHROPIC_REDIRECT_URI = `http://localhost:${ANTHROPIC_OAUTH_PORT}/callback`;
export const ANTHROPIC_SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const CALLBACK_PATH = "/callback";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const bytes = randomBytes(43);
  let verifier = "";
  for (const byte of bytes) verifier += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

function toCredential(tokens: TokenResponse, fallbackRefresh?: string): OAuthCredential {
  const refresh = tokens.refresh_token ?? fallbackRefresh;
  if (!tokens.access_token || !refresh) throw new Error("Anthropic token response was missing tokens.");
  return {
    type: "oauth",
    refresh,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000 - REFRESH_SKEW_MS,
  };
}

async function postJson(url: string, body: Record<string, string>): Promise<TokenResponse> {
  applyProxyEnv();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Anthropic token request failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as TokenResponse;
}

export function refreshAnthropic(refresh: string): Promise<OAuthCredential> {
  return postJson(ANTHROPIC_TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: ANTHROPIC_CLIENT_ID,
    refresh_token: refresh,
  }).then((tokens) => toCredential(tokens, refresh));
}

/** Browser flow: open the authorize URL and wait for the loopback callback. */
export async function loginAnthropic(onUrl: (url: string) => void): Promise<OAuthCredential> {
  const { verifier, challenge } = generatePkce();
  const state = verifier;
  const authorizeUrl = `${ANTHROPIC_AUTHORIZE_URL}?${new URLSearchParams({
    code: "true",
    client_id: ANTHROPIC_CLIENT_ID,
    response_type: "code",
    redirect_uri: ANTHROPIC_REDIRECT_URI,
    scope: ANTHROPIC_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString()}`;

  return await new Promise<OAuthCredential>((resolve, reject) => {
    let settled = false;
    const server = createServer();
    const finish = (error?: Error, credential?: OAuthCredential): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else if (credential) resolve(credential);
    };

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${ANTHROPIC_OAUTH_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404);
        response.end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (error || !code || returnedState !== state) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end("<h1>Anthropic sign-in failed</h1><p>You can close this window.</p>");
        finish(new Error(error ? `Anthropic authorization failed: ${error}` : "Anthropic OAuth state mismatch or missing code."));
        return;
      }
      postJson(ANTHROPIC_TOKEN_URL, {
        grant_type: "authorization_code",
        client_id: ANTHROPIC_CLIENT_ID,
        code,
        state,
        redirect_uri: ANTHROPIC_REDIRECT_URI,
        code_verifier: verifier,
      })
        .then((tokens) => {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<h1>Signed in to Anthropic</h1><p>You can close this window.</p>");
          finish(undefined, toCredential(tokens));
        })
        .catch((err: unknown) => {
          response.writeHead(502, { "content-type": "text/html; charset=utf-8" });
          response.end("<h1>Token exchange failed</h1>");
          finish(err instanceof Error ? err : new Error(String(err)));
        });
    });

    server.on("error", (error) => finish(error));
    server.listen(ANTHROPIC_OAUTH_PORT, "localhost", () => onUrl(authorizeUrl));
    const timer = setTimeout(() => finish(new Error("Anthropic OAuth timed out.")), LOGIN_TIMEOUT_MS);
    timer.unref?.();
  });
}
