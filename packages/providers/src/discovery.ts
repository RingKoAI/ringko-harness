export interface DiscoveredModel { id: string; name?: string }
export interface DiscoverModelsInput { type: string; baseURL?: string; apiKey?: string; providerId?: string }
export interface DiscoverModelsOptions {
  strict?: boolean;
  signal?: AbortSignal;
  bounded?: boolean;
}

export const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;
const DISCOVERY_LIMITS = { bytes: 2 * 1024 * 1024, models: 500, id: 1024, name: 512 } as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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

export function normalizeModels(payload: unknown): DiscoveredModel[] {
  const record = asRecord(payload);
  const candidates = Array.isArray(payload) ? payload : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  const seen = new Set<string>(), models: DiscoveredModel[] = [];
  for (const candidate of candidates) {
    const model = toModel(candidate);
    if (model && !seen.has(model.id)) { seen.add(model.id); models.push(model); }
  }
  return models;
}

/** Shared HTTP mechanics; providers own URLs, authentication and fallback policy. */
export async function fetchModels(url: string, headers: Record<string, string>, bounded = false, signal?: AbortSignal): Promise<DiscoveredModel[]> {
  const deadline = AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS);
  const response = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  if (!bounded) return normalizeModels(await response.json());
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Model directory returned no body.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > DISCOVERY_LIMITS.bytes) throw new Error("Model directory exceeds its size limit.");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const models = normalizeModels(JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"))).filter(model => model.id.length <= DISCOVERY_LIMITS.id && !/[\u0000-\u001f]/.test(model.id) && (!model.name || model.name.length <= DISCOVERY_LIMITS.name && !/[\u0000-\u001f]/.test(model.name)));
  if (!models.length || models.length > DISCOVERY_LIMITS.models) throw new Error("Model directory has no usable models or exceeds its entry limit.");
  return models;
}
