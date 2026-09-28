// MCP authorization (RFC 9728 protected-resource + RFC 8414 AS metadata) with
// dynamic client registration (RFC 7591) and authorization-code + PKCE. Used for
// remote servers such as Cloudflare's; tokens land in `tool.auth.json`.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { getToolAuth, setToolAuth, type ToolOAuthCredential } from "@ringko-ai/config";

const CALLBACK_PATH = "/callback";
const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 60_000;

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getJson(url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const parsed: unknown = await response.json();
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface McpAuthServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

/** Discover the authorization server and its endpoints for a remote MCP URL. */
export async function discoverAuthServer(serverUrl: string): Promise<McpAuthServer> {
  const resource = new URL(serverUrl);
  const origin = resource.origin;
  const path = resource.pathname.replace(/\/$/, "");
  let asUrl = origin;
  for (const candidate of [
    `${origin}/.well-known/oauth-protected-resource${path}`,
    `${origin}/.well-known/oauth-protected-resource`,
  ]) {
    const metadata = await getJson(candidate);
    const servers = metadata?.authorization_servers;
    if (Array.isArray(servers) && typeof servers[0] === "string" && servers[0].length > 0) {
      asUrl = servers[0];
      break;
    }
  }

  const asBase = new URL(asUrl);
  const asPath = asBase.pathname.replace(/\/$/, "");
  const meta =
    (await getJson(`${asBase.origin}/.well-known/oauth-authorization-server${asPath}`)) ??
    (await getJson(`${asBase.origin}/.well-known/openid-configuration${asPath}`));
  const authorizationEndpoint = typeof meta?.authorization_endpoint === "string" ? meta.authorization_endpoint : undefined;
  const tokenEndpoint = typeof meta?.token_endpoint === "string" ? meta.token_endpoint : undefined;
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error("MCP server did not advertise OAuth authorization/token endpoints.");
  }
  return {
    issuer: asUrl,
    authorizationEndpoint,
    tokenEndpoint,
    ...(typeof meta?.registration_endpoint === "string" ? { registrationEndpoint: meta.registration_endpoint } : {}),
    ...(Array.isArray(meta?.scopes_supported)
      ? { scopesSupported: meta.scopes_supported.filter((item): item is string => typeof item === "string") }
      : {}),
  };
}

interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
}

async function registerClient(as: McpAuthServer, redirectUri: string): Promise<RegisteredClient> {
  if (!as.registrationEndpoint) {
    throw new Error("MCP authorization server has no dynamic client registration endpoint.");
  }
  const response = await fetch(as.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "RingKo",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Client registration failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { client_id?: unknown; client_secret?: unknown };
  if (typeof data.client_id !== "string" || data.client_id.length === 0) {
    throw new Error("Client registration returned no client_id.");
  }
  return {
    clientId: data.client_id,
    ...(typeof data.client_secret === "string" ? { clientSecret: data.client_secret } : {}),
  };
}

async function requestToken(
  tokenEndpoint: string,
  form: Record<string, string>,
  client: RegisteredClient,
  resource: string,
  scopes?: string[],
): Promise<ToolOAuthCredential> {
  const body: Record<string, string> = { ...form, client_id: client.clientId };
  if (client.clientSecret) body.client_secret = client.clientSecret;
  if (resource.length > 0) body.resource = resource;
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Token request failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("Token response was missing an access token.");
  }
  return {
    type: "oauth",
    access: data.access_token,
    expires: Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000,
    ...(typeof data.refresh_token === "string" ? { refresh: data.refresh_token } : {}),
    tokenEndpoint,
    clientId: client.clientId,
    ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    ...(resource.length > 0 ? { resource } : {}),
  };
}

/**
 * Run the loopback authorization-code flow. `onUrl` receives the authorize URL
 * to open; resolves once the callback is exchanged for a credential.
 */
export async function authorizeMcpServer(
  serverUrl: string,
  onUrl: (url: string) => void,
): Promise<ToolOAuthCredential> {
  const as = await discoverAuthServer(serverUrl);
  const verifier = base64Url(randomBytes(43));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const stateValue = base64Url(randomBytes(24));

  return await new Promise<ToolOAuthCredential>((resolve, reject) => {
    let settled = false;
    let registered: RegisteredClient | undefined;
    let redirectUri = "";
    const server = createServer();
    const finish = (error?: Error, credential?: ToolOAuthCredential): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else if (credential) resolve(credential);
    };

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404);
        response.end();
        return;
      }
      if (url.searchParams.get("state") !== stateValue) {
        response.writeHead(400);
        response.end("state mismatch");
        finish(new Error("MCP OAuth state mismatch."));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code || !registered || redirectUri.length === 0) {
        response.writeHead(400);
        response.end("missing code");
        finish(new Error("MCP OAuth authorization code missing."));
        return;
      }
      requestToken(
        as.tokenEndpoint,
        { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier },
        registered,
        serverUrl,
        as.scopesSupported,
      )
        .then((credential) => {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<h1>Signed in</h1><p>You can close this window.</p>");
          finish(undefined, credential);
        })
        .catch((error: unknown) => {
          response.writeHead(502);
          response.end("token exchange failed");
          finish(error instanceof Error ? error : new Error(String(error)));
        });
    });

    server.on("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
      registerClient(as, redirectUri)
        .then((client) => {
          registered = client;
          const authorize = new URL(as.authorizationEndpoint);
          authorize.searchParams.set("response_type", "code");
          authorize.searchParams.set("client_id", client.clientId);
          authorize.searchParams.set("redirect_uri", redirectUri);
          authorize.searchParams.set("code_challenge", challenge);
          authorize.searchParams.set("code_challenge_method", "S256");
          authorize.searchParams.set("state", stateValue);
          authorize.searchParams.set("resource", serverUrl);
          if (as.scopesSupported && as.scopesSupported.length > 0) {
            authorize.searchParams.set("scope", as.scopesSupported.join(" "));
          }
          onUrl(authorize.toString());
        })
        .catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
    });

    const timer = setTimeout(() => finish(new Error("MCP authorization timed out.")), AUTHORIZE_TIMEOUT_MS);
    timer.unref?.();
  });
}

/** Refresh a stored tool OAuth token when it is near expiry; returns its access token. */
export async function ensureToolAuth(name: string): Promise<string | undefined> {
  const info = getToolAuth(name);
  if (!info || info.type !== "oauth") return undefined;
  if (info.expires > Date.now() + REFRESH_SKEW_MS) return info.access;
  if (!info.refresh || !info.tokenEndpoint || !info.clientId) return info.access;
  const response = await fetch(info.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: info.refresh,
      client_id: info.clientId,
      ...(info.clientSecret ? { client_secret: info.clientSecret } : {}),
      ...(info.resource ? { resource: info.resource } : {}),
    }).toString(),
  });
  if (!response.ok) return info.access;
  const data = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string") return info.access;
  const next: ToolOAuthCredential = {
    ...info,
    access: data.access_token,
    expires: Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000,
    ...(typeof data.refresh_token === "string" ? { refresh: data.refresh_token } : {}),
  };
  setToolAuth(name, next);
  return next.access;
}
