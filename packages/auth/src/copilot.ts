// GitHub Copilot device-code login (RFC 8628) + Copilot API token exchange.
//
// The GitHub OAuth token is exchanged for a short-lived Copilot API token at
// `api.github.com/copilot_internal/v2/token`; requests to api.githubcopilot.com
// use that exchanged token.
import { applyProxyEnv, type OAuthCredential } from "@ringko-ai/config";

/** Official GitHub Copilot OAuth app (`Iv1.b507a08c87ecfe98`). */
export const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const POLLING_SAFETY_MARGIN_MS = 3000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Editor identity Copilot's token/model endpoints expect. */
const COPILOT_HEADERS: Record<string, string> = {
  "user-agent": "GitHubCopilotChat/0.35.0",
  "editor-version": "vscode/1.107.0",
  "editor-plugin-version": "copilot-chat/0.35.0",
  "copilot-integration-id": "vscode-chat",
};

export interface GitHubIdentity {
  id: string;
  login: string;
  avatarUrl?: string;
}

interface DeviceCodeResponse {
  verification_uri: string;
  user_code: string;
  device_code: string;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  interval?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function githubHeaders(): Record<string, string> {
  return { accept: "application/json", "content-type": "application/json" };
}

/** Exchange a GitHub OAuth token for a Copilot API token. */
async function exchangeCopilotToken(githubToken: string): Promise<{ access: string; expires: number }> {
  applyProxyEnv();
  const response = await fetch(COPILOT_TOKEN_URL, {
    headers: { authorization: `Bearer ${githubToken}`, accept: "application/json", ...COPILOT_HEADERS },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Copilot token exchange failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof data.token !== "string" || data.token.length === 0) {
    throw new Error("Copilot token exchange response was incomplete.");
  }
  const expires = typeof data.expires_at === "number" ? data.expires_at * 1000 : Date.now() + 3_600_000;
  return { access: data.token, expires: expires - REFRESH_SKEW_MS };
}

/** Read the signed-in GitHub user (login + avatar) for the stored token. */
export async function fetchGitHubIdentity(accessToken: string): Promise<GitHubIdentity | undefined> {
  try {
    applyProxyEnv();
    const response = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "ringko",
      },
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { id?: unknown; login?: unknown; avatar_url?: unknown };
    if (typeof data.id !== "number" || typeof data.login !== "string") return undefined;
    return {
      id: String(data.id),
      login: data.login,
      ...(typeof data.avatar_url === "string" ? { avatarUrl: data.avatar_url } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Refresh: the stored `refresh` is the GitHub token; re-exchange for a Copilot token. */
export function refreshGitHubCopilot(githubToken: string): Promise<OAuthCredential> {
  return exchangeCopilotToken(githubToken).then(({ access, expires }) => ({
    type: "oauth",
    refresh: githubToken,
    access,
    expires,
  }));
}

/** Run the GitHub device flow; resolves with the Copilot API credential. */
export async function loginGitHubCopilot(onCode: (url: string, code: string) => void): Promise<OAuthCredential> {
  applyProxyEnv();
  const start = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: "read:user" }),
  });
  if (!start.ok) throw new Error(`GitHub device authorization failed: ${start.status}`);
  const device = (await start.json()) as DeviceCodeResponse;
  onCode(device.verification_uri, device.user_code);

  let interval = Math.max(1, device.interval || 5);
  for (;;) {
    await sleep(interval * 1000 + POLLING_SAFETY_MARGIN_MS);
    const response = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: githubHeaders(),
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: device.device_code,
        grant_type: DEVICE_GRANT,
      }),
    });
    if (!response.ok) throw new Error(`GitHub token request failed: ${response.status}`);
    const data = (await response.json()) as AccessTokenResponse;
    if (data.access_token) {
      const identity = await fetchGitHubIdentity(data.access_token);
      const copilot = await exchangeCopilotToken(data.access_token);
      return {
        type: "oauth",
        refresh: data.access_token,
        access: copilot.access,
        expires: copilot.expires,
        ...(identity
          ? {
              accountId: identity.id,
              login: identity.login,
              ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
            }
          : {}),
      };
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval = data.interval && data.interval > 0 ? data.interval : interval + 5;
      continue;
    }
    if (data.error) throw new Error(`GitHub authorization failed: ${data.error}`);
  }
}
