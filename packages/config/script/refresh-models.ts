// Refresh the bundled model catalog snapshot.
//
//   RINGKO_MODELS_URL=https://models.ringkoai.com/catalog.json \
//     bun packages/config/script/refresh-models.ts
//
// The source defaults to models.dev; point it at our own mirror endpoint once it
// is live. Set MODELS_DEV_API_JSON to read a local file instead of fetching.
// Output is filtered to the provider types RingKo supports and committed as
// `packages/config/models.dev.json`.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** RingKo provider type -> upstream provider id. */
const PROVIDER_TYPES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "github-copilot": "github-copilot",
};

interface UpstreamModel {
  id?: string;
  name?: string;
}
interface UpstreamProvider {
  models?: Record<string, UpstreamModel>;
}

const outfile = resolve(import.meta.dir, "../models.dev.json");

async function loadSource(): Promise<string> {
  const local = process.env.MODELS_DEV_API_JSON?.trim();
  if (local) return await Bun.file(local).text();
  const url = process.env.RINGKO_MODELS_URL?.trim() || "https://models.dev/api.json";
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return await response.text();
}

function selectModels(provider: UpstreamProvider | undefined): { id: string; name: string }[] {
  const models = provider?.models;
  if (!models) return [];
  return Object.values(models)
    .map((model) => ({ id: model.id ?? "", name: model.name ?? model.id ?? "" }))
    .filter((model) => model.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const upstream = JSON.parse(await loadSource()) as Record<string, UpstreamProvider>;
const catalog: Record<string, { id: string; name: string }[]> = {};
for (const [type, providerId] of Object.entries(PROVIDER_TYPES)) {
  catalog[type] = selectModels(upstream[providerId]);
}

writeFileSync(outfile, `${JSON.stringify(catalog, null, 2)}\n`);
const count = Object.values(catalog).reduce((total, models) => total + models.length, 0);
console.log(`wrote ${count} model(s) across ${Object.keys(catalog).length} provider type(s) -> ${outfile}`);
