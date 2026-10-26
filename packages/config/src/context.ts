import type { ModelDefinition } from "./config.ts";
import { validTokenLimit, type ModelMetadata } from "./model-metadata.ts";

/** Shared host defaults when a model does not declare its token limits. */
export const DEFAULT_CONTEXT_LIMITS = {
  contextWindow: 128_000,
  reserveOutputTokens: 4096,
} as const;

export interface ContextLimits {
  contextWindow: number;
  reserveOutputTokens: number;
  maxInputTokens?: number;
}

/** Resolve host-owned limits once; missing or invalid counts use the shared defaults. */
export function resolveContextLimits(input: Partial<ContextLimits> = {}): ContextLimits {
  return {
    contextWindow: validTokenLimit(input.contextWindow) ? input.contextWindow : DEFAULT_CONTEXT_LIMITS.contextWindow,
    reserveOutputTokens: validTokenLimit(input.reserveOutputTokens) ? input.reserveOutputTokens : DEFAULT_CONTEXT_LIMITS.reserveOutputTokens,
    ...(validTokenLimit(input.maxInputTokens) ? { maxInputTokens: input.maxInputTokens } : {}),
  };
}

/** Manual fields win independently; legacy maxInputTokens still overrides the window. */
export function resolveModelContext(model: ModelDefinition, metadata?: ModelMetadata): ContextLimits {
  const manualInput = validTokenLimit(model.maxInputTokens) ? model.maxInputTokens : undefined;
  const manualOutput = validTokenLimit(model.maxOutputTokens) ? model.maxOutputTokens : undefined;
  return resolveContextLimits({
    contextWindow: validTokenLimit(model.contextWindow) ? model.contextWindow : manualInput ?? metadata?.limit.context,
    maxInputTokens: manualInput ?? metadata?.limit.input,
    // A catalog output ceiling is not a request to reserve that entire ceiling.
    reserveOutputTokens: manualOutput ?? Math.min(DEFAULT_CONTEXT_LIMITS.reserveOutputTokens, metadata?.limit.output ?? DEFAULT_CONTEXT_LIMITS.reserveOutputTokens),
  });
}
