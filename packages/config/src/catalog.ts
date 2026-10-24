// Model catalog.
//
// Two data files, both maintained alongside the docs (model ids are data, not
// code):
//   - `models.json`     hand-curated overrides (win when non-empty)
//   - `models.dev.json` generated snapshot, refreshed by
//     `bun packages/config/script/refresh-models.ts` (see the models-snapshot
//     workflow). The refresh script fetches `RINGKO_MODELS_URL` (default:
//     models.dev) so it can point at our own mirror endpoint.
import curated from "../models.json";
import snapshot from "../models.dev.json";

export interface CatalogModel {
  id: string;
  name?: string;
}

export type ModelCatalog = Record<string, CatalogModel[]>;

const CURATED = curated as ModelCatalog;
const SNAPSHOT = snapshot as ModelCatalog;

function isCatalogModel(value: unknown): value is CatalogModel {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CatalogModel).id === "string" &&
    (value as CatalogModel).id.length > 0
  );
}

function listFrom(source: ModelCatalog, type: string): CatalogModel[] {
  const entry = source[type];
  return Array.isArray(entry) ? entry.filter(isCatalogModel) : [];
}

/** Known models for a provider type: curated overrides, else the snapshot. */
export function knownModels(type: string | undefined): CatalogModel[] {
  if (!type) return [];
  const overrides = listFrom(CURATED, type);
  return overrides.length > 0 ? overrides : listFrom(SNAPSHOT, type);
}

/** Provider types that have a catalogued model list. */
export function cataloguedTypes(): string[] {
  return [...new Set([...Object.keys(CURATED), ...Object.keys(SNAPSHOT)])];
}
