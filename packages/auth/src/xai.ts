// xAI (Grok) OAuth device-code login, mirroring the grok CLI (RFC 8628).
import { applyProxyEnv, type OAuthCredential } from "@ringko-ai/config";
import type { QuotaTier } from "./openai.ts";

export const XAI_ISSUER = "https://auth.x.ai";
export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_SCOPES = "openid profile email offline_access grok-cli:access api:access";
export const XAI_INFERENCE_BASE_URL = "https://api.x.ai/v1";
/** cli-chat-proxy base; the grok CLI reaches billing/usage here. */
export const XAI_CLI_CHAT_PROXY_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const POLL_SAFETY_MARGIN_MS = 3000;
const DEFAULT_INTERVAL_SECS = 5;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
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

/** Identity (sub + email) from the id token claims. */
function identity(idToken: string | undefined): { accountId?: string; login?: string } {
  const claims = decodeJwt(idToken);
  if (!claims) return {};
  const accountId = typeof claims.sub === "string" && claims.sub.length > 0 ? claims.sub : undefined;
  const login = typeof claims.email === "string" && claims.email.length > 0 ? claims.email : undefined;
  return { ...(accountId ? { accountId } : {}), ...(login ? { login } : {}) };
}

function toCredential(tokens: TokenResponse, fallbackRefresh?: string): OAuthCredential {
  if (!tokens.access_token) throw new Error("xAI token response was missing an access token.");
  const refresh = tokens.refresh_token ?? fallbackRefresh ?? tokens.access_token;
  const id = identity(tokens.id_token);
  return {
    type: "oauth",
    refresh,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...id,
  };
}

/** Low-cardinality client identity headers the xAI OAuth2 provider expects. */
function xaiHeaders(): Record<string, string> {
  return {
    "x-grok-client-version": process.env.RINGKO_GROK_VERSION ?? "0.1.0",
    "x-grok-client-surface": "cli",
    accept: "application/json",
  };
}

async function postForm(url: string, form: Record<string, string>): Promise<TokenResponse> {
  applyProxyEnv();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...xaiHeaders() },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`xAI token request failed: ${response.status} ${body.slice(0, 200)}`);
  }
  return (await response.json()) as TokenResponse;
}

export function refreshXai(refresh: string): Promise<OAuthCredential> {
  return postForm(`${XAI_ISSUER}/oauth2/token`, {
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: XAI_CLIENT_ID,
  }).then((tokens) => toCredential(tokens, refresh));
}

/** Run the xAI device flow; `onCode` receives the verification URL and user code. */
export async function loginXaiDevice(onCode: (url: string, code: string) => void): Promise<OAuthCredential> {
  applyProxyEnv();
  const start = await fetch(`${XAI_ISSUER}/oauth2/device/code`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...xaiHeaders() },
    body: new URLSearchParams({ client_id: XAI_CLIENT_ID, scope: XAI_SCOPES, referrer: "grok-build" }).toString(),
  });
  if (!start.ok) throw new Error(`xAI device authorization failed: ${start.status}`);
  const device = (await start.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    expires_in?: number;
  };
  if (!device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error("xAI device authorization response was incomplete.");
  }
  onCode(device.verification_uri, device.user_code);

  let interval = Math.max(1, device.interval ?? DEFAULT_INTERVAL_SECS);
  const deadline = Date.now() + Math.max(600, device.expires_in ?? 600) * 1000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("xAI device code expired.");
    await sleep(interval * 1000 + POLL_SAFETY_MARGIN_MS);
    const response = await fetch(`${XAI_ISSUER}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...xaiHeaders() },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT,
        device_code: device.device_code,
        client_id: XAI_CLIENT_ID,
      }).toString(),
    });
    if (response.ok) return toCredential((await response.json()) as TokenResponse);
    const error = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string };
    if (error.error === "authorization_pending") continue;
    if (error.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (error.error === "access_denied") throw new Error("xAI authorization was denied.");
    if (error.error === "expired_token") throw new Error("xAI device code expired.");
    throw new Error(`xAI authorization failed: ${error.error_description ?? error.error ?? String(response.status)}`);
  }
}

export interface XaiQuota {
  tiers: QuotaTier[];
  /** Subscription tier name (e.g. "SuperGrok Heavy"). */
  plan?: string;
}

interface XaiBilling {
  config?: {
    creditUsagePercent?: number;
    currentPeriod?: { type?: string; start?: string; end?: string };
    prepaidBalance?: { val?: number };
  };
  subscriptionTier?: string;
}

function periodLabel(type: string | undefined): string {
  if (!type) return "period";
  const value = type.toLowerCase();
  if (value.includes("week")) return "weekly";
  if (value.includes("month")) return "monthly";
  if (value.includes("day")) return "daily";
  return "period";
}

/** Query the Grok Build credits/usage for an OAuth access token. */
export async function queryXaiQuota(access: string, accountId?: string): Promise<XaiQuota> {
  applyProxyEnv();
  const headers: Record<string, string> = {
    authorization: `Bearer ${access}`,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": process.env.RINGKO_GROK_VERSION ?? "0.1.0",
    accept: "application/json",
  };
  if (accountId) headers["x-userid"] = accountId;
  const response = await fetch(`${XAI_CLI_CHAT_PROXY_BASE_URL}/billing?format=credits`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`xAI quota request failed: ${response.status}`);
  const body = (await response.json()) as XaiBilling;
  const tiers: QuotaTier[] = [];
  const config = body.config;
  if (config && typeof config.creditUsagePercent === "number") {
    const end = config.currentPeriod?.end ? Date.parse(config.currentPeriod.end) : Number.NaN;
    tiers.push({
      name: periodLabel(config.currentPeriod?.type),
      utilization: config.creditUsagePercent,
      ...(Number.isFinite(end) ? { resetsAt: end } : {}),
    });
  }
  return { tiers, ...(body.subscriptionTier ? { plan: body.subscriptionTier } : {}) };
}
