// Provider OAuth flow metadata shared by the auth handlers.

export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
export const OAUTH_ISSUE_TIMEOUT_MS = 30 * 1000;

export interface OAuthFlow {
  status: "pending" | "success" | "error";
  error?: string;
  createdAt: number;
}

/** Map an auth domain to the OAuth flow it speaks, if any. */
export function oauthKind(domain: string): "openai" | "copilot" | "xai" | "anthropic" | undefined {
  if (domain === "openai-oauth") return "openai";
  if (domain === "github-copilot") return "copilot";
  if (domain === "xai-oauth") return "xai";
  if (domain === "anthropic-oauth") return "anthropic";
  return undefined;
}

export function pruneOAuthFlows(flows: Map<string, OAuthFlow>, now: number): void {
  for (const [id, flow] of flows) {
    if (now - flow.createdAt > OAUTH_FLOW_TTL_MS) flows.delete(id);
  }
}
