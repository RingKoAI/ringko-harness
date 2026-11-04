// Provider account, OAuth flow and quota endpoints.

import { BASE, UnauthorizedError, authHeaders, errorFrom, getJson } from "./http";
import type { AuthStatus, OAuthFlowStatus, OAuthStart, QuotaResponse } from "../api";

async function postAuth(path: string, body: unknown, fallback: string): Promise<AuthStatus> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw await errorFrom(response, fallback);
  return (await response.json()) as AuthStatus;
}

export function fetchAuth(): Promise<AuthStatus> {
  return getJson<AuthStatus>('/api/auth');
}

export async function startOAuth(domain: string): Promise<OAuthStart> {
  const response = await fetch(`${BASE}/api/auth/oauth`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ domain }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw await errorFrom(response, `OAuth start failed (${response.status}).`);
  return (await response.json()) as OAuthStart;
}

export function fetchOAuthStatus(flowId: string): Promise<{ status: OAuthFlowStatus; error?: string }> {
  return getJson(`/api/auth/oauth/${encodeURIComponent(flowId)}`);
}
export function fetchQuota(domain: string, accountId: string): Promise<QuotaResponse> {
  return getJson<QuotaResponse>(
    `/api/auth/quota?domain=${encodeURIComponent(domain)}&accountId=${encodeURIComponent(accountId)}`,
  );
}
export function setDefaultAuth(domain: string, accountId: string): Promise<AuthStatus> {
  return postAuth('/api/auth/default', { domain, accountId }, 'Could not set the default account.');
}

export function removeAuthAccount(domain: string, accountId: string): Promise<AuthStatus> {
  return postAuth('/api/auth/remove', { domain, accountId }, 'Could not remove the account.');
}
