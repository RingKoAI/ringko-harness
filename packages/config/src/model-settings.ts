import { isRecord } from "./util.ts";
import { validTokenLimit } from "./model-metadata.ts";
import type { ModelDefinition } from "./config.ts";

/** Validate model edits without dropping existing model metadata. */
export function parseModelDefinition(value: unknown): ModelDefinition {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || value.id.length > 1024) throw new TypeError("Model ID must be a non-empty string up to 1024 characters.");
  if (value.name !== undefined && (typeof value.name !== "string" || value.name.length > 1024)) throw new TypeError("Model name must be a string up to 1024 characters.");
  for (const field of ["contextWindow", "maxInputTokens", "maxOutputTokens"] as const) {
    if (value[field] !== undefined && !validTokenLimit(value[field])) throw new TypeError(`${field} must be a positive safe integer, or omitted for automatic limits.`);
  }
  if (typeof value.contextWindow === "number") {
    for (const field of ["maxInputTokens", "maxOutputTokens"] as const) if (typeof value[field] === "number" && value[field] > value.contextWindow) throw new TypeError(`${field} must not exceed contextWindow.`);
  }
  if (value.catalogId !== undefined && (typeof value.catalogId !== "string" || value.catalogId.length > 1024 || !/^[^/]+\/.+$/.test(value.catalogId))) throw new TypeError("catalogId must use provider/model format.");
  return { ...value, name: typeof value.name === "string" && value.name ? value.name : value.id } as ModelDefinition;
}
