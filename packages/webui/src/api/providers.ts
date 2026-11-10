// Provider discovery and configuration endpoints.

import { BASE, UnauthorizedError, authHeaders, errorFrom, getJson } from "./http";
import type { Info, ProviderFile, ProviderDefinition } from "../api";

export function fetchProviders(): Promise<ProviderFile> {
  return getJson<ProviderFile>("/api/providers");
}

export interface ProviderPreset {
  id: string;
  label: string;
  type: string;
  baseURL?: string;
  apiKeyEnv?: string;
  auth?: string;
  docs?: string;
}

export function fetchPresets(): Promise<{ presets: ProviderPreset[] }> {
  return getJson<{ presets: ProviderPreset[] }>("/api/presets");
}

export async function saveProviders(file: ProviderFile): Promise<Info> {
  const response = await fetch(`${BASE}/api/providers`, {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(file),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    throw await errorFrom(response, `Save failed (${response.status}).`);
  }
  return (await response.json()) as Info;
}

export interface DiscoveredProviderModel { id: string; name?: string }

export interface ModelContextPreview {
  automatic: { contextWindow: number; reserveOutputTokens: number; maxInputTokens?: number };
  metadata: { id: string; name?: string; limit: { context?: number; input?: number; output?: number } } | null;
}
export async function previewModelContext(input: { provider: Pick<ProviderDefinition, 'name' | 'type' | 'vendor' | 'baseURL' | 'url'>; model: { id: string; name: string; catalogId?: string } }, signal: AbortSignal): Promise<ModelContextPreview> {
  const response = await fetch(`${BASE}/api/providers/context`, { method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(input), signal });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? body.error : `Context lookup failed (${response.status}).`);
  }
  return await response.json() as ModelContextPreview;
}

/** Query a provider endpoint for its model list using the host-side provider module. */
export async function discoverProviderModels(input: { name: string; type: string; baseURL?: string; apiKey?: string }): Promise<{ models: DiscoveredProviderModel[]; truncated?: boolean }> {
  const response = await fetch(`${BASE}/api/providers/models`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof detail?.error === "string" ? detail.error : `Model discovery failed (${response.status}).`);
  }
  return (await response.json()) as { models: DiscoveredProviderModel[]; truncated?: boolean };
}
