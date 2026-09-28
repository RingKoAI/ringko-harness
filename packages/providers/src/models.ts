// Model discovery: query a provider's `/models` endpoint when it has one, and
// fall back to the maintained catalog (`@ringko-ai/config` `models.json`).
import { applyProxyEnv, getAuth, knownModels } from "@ringko-ai/config";
import { CODEX_ORIGINATOR, OPENAI_CODEX_ENDPOINT, codexUserAgent, codexVersion } from "@ringko-ai/auth";

export interface DiscoveredModel {
  id: string;
  name?: string;
}

export const COPILOT_MODELS_URL = "https://api.githubcopilot.com/models";
const GITHUB_API_VERSION = "2026-06-01";

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
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return normalizeModels(await response.json());
}

/** Discover models for a provider type; live when possible, catalog otherwise. */
export async function discoverModels(input: {
  type: string;
  baseURL?: string;
  apiKey?: string;
  providerId?: string;
}): Promise<DiscoveredModel[]> {
  applyProxyEnv();
  const auth = (providerId: string) => getAuth(input.providerId ?? providerId);
  try {
    if (input.type === "openai") {
      const base = (input.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
      return await fetchModels(`${base}/models`, input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {});
    }
    if (input.type === "openai-compatible") {
      if (!input.baseURL) return knownModels(input.type);
      const base = input.baseURL.replace(/\/+$/, "");
      return await fetchModels(`${base}/models`, input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {});
    }
    if (input.type === "github-copilot") {
      const credential = auth("github-copilot");
      if (credential?.type === "oauth") {
        return await fetchModels(COPILOT_MODELS_URL, {
          authorization: `Bearer ${credential.access}`,
          "x-github-api-version": GITHUB_API_VERSION,
        });
      }
      return knownModels(input.type);
    }
    if (input.type === "openai-oauth") {
      const credential = auth("openai");
      if (credential?.type === "oauth") {
        try {
          const request = codexModelsRequest(credential.access, credential.accountId);
          const live = await fetchModels(request.url, request.headers);
          if (live.length > 0) return live;
        } catch {
          // No usable endpoint; use the catalog below.
        }
      }
      return knownModels(input.type);
    }
  } catch {
    return knownModels(input.type);
  }
  return knownModels(input.type);
}
