import { describe, expect, it } from "bun:test";
import { DEFAULT_CONTEXT_LIMITS, resolveContextLimits } from "../src/context.ts";

describe("shared context limits", () => {
  it("keeps explicit model limits and fills only missing fields", () => {
    expect(resolveContextLimits({ contextWindow: 262_144, reserveOutputTokens: 8192 })).toEqual({ contextWindow: 262_144, reserveOutputTokens: 8192 });
    expect(resolveContextLimits({ contextWindow: 262_144 })).toEqual({ ...DEFAULT_CONTEXT_LIMITS, contextWindow: 262_144 });
    expect(resolveContextLimits()).toEqual(DEFAULT_CONTEXT_LIMITS);
  });

  it("uses the same defaults for malformed token counts", () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(resolveContextLimits({ contextWindow: value, reserveOutputTokens: value })).toEqual(DEFAULT_CONTEXT_LIMITS);
    }
  });
});
