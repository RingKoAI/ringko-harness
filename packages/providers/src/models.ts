// Model discovery: query a provider's `/models` endpoint when it has one, and
// fall back to the maintained catalog (`@ringko-ai/config` `models.json`).
import { applyProxyEnv, getOAuthAccount, knownModels } from "@ringko-ai/config";
import { CODEX_ORIGINATOR, OPENAI_CODEX_ENDPOINT, XAI_CLI_CHAT_PROXY_BASE_URL, codexUserAgent, codexVersion } from "@ringko-ai/auth";
import { COPILOT_AUTH_DOMAIN, COPILOT_CLIENT_HEADERS, GITHUB_API_VERSION } from "./github-copilot/index.ts";
import { OPENAI_OAUTH_DOMAIN } from "./openai/index.ts";
import { XAI_OAUTH_DOMAIN } from "./xai/index.ts";

export interface DiscoveredModel {
  id: string;
  name?: string;
}

export const COPILOT_MODELS_URL = "https://api.githubcopilot.com/models";
/** Live model discovery must not hang a settings request indefinitely. */
export const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;

/** Build the Codex model discovery request using the same client identity as inference. */
export function codexModelsRequest(access: string, accountId?: string): {
  url: string;
  headers: Record<string, string>;
} {
  const url = new URL(`${OPENAI_CODEX_ENDPOINT}/models`);
  url.searchParams.set("client_version", codexVersion());
  return {
    url: url.toString(),
    headers: {
      authorization: `Bearer ${access}`,
      originator: CODEX_ORIGINATOR,
      "user-agent": codexUserAgent(),
      ...(accountId ? { "chatgpt-account-id": accountId } : {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toModel(value: unknown): DiscoveredModel | undefined {
  if (typeof value === "string" && value.length > 0) return { id: value };
  const record = asRecord(value);
  if (!record) return undefined;
  const id = record.id ?? record.slug ?? record.name ?? record.model;
  if (typeof id !== "string" || id.length === 0) return undefined;
  const name = record.display_name ?? record.displayName ?? record.name;
  return { id, ...(typeof name === "string" && name.length > 0 ? { name } : {}) };
}

/** Normalize common `/models` payload shapes into a model list. */
export function normalizeModels(payload: unknown): DiscoveredModel[] {
  const record = asRecord(payload);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : [];
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const candidate of candidates) {
    const model = toModel(candidate);
    if (model && !seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }
  return models;
}

async function fetchModels(url: string, headers: Record<string, string>): Promise<DiscoveredModel[]> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return normalizeModels(await response.json());
}

export interface DiscoverModelsOptions {
  /** Rethrow a live lookup failure instead of falling back to the catalog. */
  strict?: boolean;
}

/** Discover models for a provider type; live when possible, catalog otherwise. */
export async function discoverModels(input: {
  type: string;
  baseURL?: string;
  apiKey?: string;
  providerId?: string;
}, options: DiscoverModelsOptions = {}): Promise<DiscoveredModel[]> {
  applyProxyEnv();
  const strict = options.strict === true;
  const catalog = (): DiscoveredModel[] => knownModels(input.type);
  const live = async (url: string, headers: Record<string, string>): Promise<DiscoveredModel[]> => {
    try {
      return await fetchModels(url, headers);
    } catch (error) {
      if (strict) throw error;
      return catalog();
    }
  };
  if (input.type === "openai") {
    const base = (input.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    return live(`${base}/models`, input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {});
  }
  if (input.type === "openai-compatible") {
    if (!input.baseURL) return catalog();
    const base = input.baseURL.replace(/\/+$/, "");
    return live(`${base}/models`, input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {});
  }
  if (input.type === "github-copilot") {
    const account = getOAuthAccount(COPILOT_AUTH_DOMAIN);
    if (!account) return catalog();
    return live(COPILOT_MODELS_URL, {
      authorization: `Bearer ${account.credential.access}`,
      "x-github-api-version": GITHUB_API_VERSION,
      ...COPILOT_CLIENT_HEADERS,
    });
  }
  if (input.type === "xai-oauth") {
    const account = getOAuthAccount(XAI_OAUTH_DOMAIN);
    if (!account) return catalog();
    return live(`${XAI_CLI_CHAT_PROXY_BASE_URL}/models`, {
      authorization: `Bearer ${account.credential.access}`,
      "x-xai-token-auth": "xai-grok-cli",
    });
  }
  if (input.type === "openai-oauth") {
    const account = getOAuthAccount(OPENAI_OAUTH_DOMAIN);
    if (!account) return catalog();
    const request = codexModelsRequest(account.credential.access, account.credential.accountId);
    try {
      const models = await fetchModels(request.url, request.headers);
      return models.length > 0 ? models : catalog();
    } catch (error) {
      if (strict) throw error;
      return catalog();
    }
  }
  return catalog();
}
