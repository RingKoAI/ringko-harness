import { expect, it } from "bun:test";
import { cacheHitRate } from "../src/usage.ts";

it("uses total input as the cache denominator because input already includes cached tokens", () => {
  expect(cacheHitRate({ calls: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 20 })).toBe(0.6);
  expect(cacheHitRate({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
});
