import { isRecord } from "./util.ts";
import { validTokenLimit } from "./model-metadata.ts";
import type { ModelDefinition } from "./config.ts";

/** Longest accepted thinking-level key in a model's reasoning override map. */
const REASONING_KEY_LIMIT = 32;
/** Longest accepted wire value in a model's reasoning override map. */
const REASONING_VALUE_LIMIT = 128;

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
  if (value.reasoningEfforts !== undefined) validateReasoningEfforts(value.reasoningEfforts);
  return { ...value, name: typeof value.name === "string" && value.name ? value.name : value.id } as ModelDefinition;
}

/**
 * Validate the per-level reasoning override map of one model.
 * @param value - candidate `reasoningEfforts` value.
 * @returns the same value once every entry is usable.
 * @throws TypeError when the value is not a record of non-empty string pairs.
 */
function validateReasoningEfforts(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new TypeError("reasoningEfforts must map thinking levels to values.");
  for (const [level, effort] of Object.entries(value)) {
    if (!level.trim() || level.length > REASONING_KEY_LIMIT) throw new TypeError(`reasoningEfforts level "${level}" must be a non-empty string up to ${REASONING_KEY_LIMIT} characters.`);
    if (typeof effort !== "string" || !effort.trim() || effort.length > REASONING_VALUE_LIMIT) throw new TypeError(`reasoningEfforts value for "${level}" must be a non-empty string up to ${REASONING_VALUE_LIMIT} characters.`);
  }
  return value as Record<string, string>;
}
