// GitHub Copilot device-code login (RFC 8628).
import { applyProxyEnv, type OAuthCredential } from "@ringko-ai/config";

export const COPILOT_CLIENT_ID = "Ov23li8tweQw6odWQebz";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const POLLING_SAFETY_MARGIN_MS = 3000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

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

/** Run the GitHub device flow; resolves with the (long-lived) access token. */
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
      return { type: "oauth", refresh: data.access_token, access: data.access_token, expires: 0 };
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval = data.interval && data.interval > 0 ? data.interval : interval + 5;
      continue;
    }
    if (data.error) throw new Error(`GitHub authorization failed: ${data.error}`);
  }
}
