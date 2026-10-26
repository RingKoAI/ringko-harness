import { describe, expect, it } from "bun:test";
import { findModelMetadata, parseModelMetadata } from "../src/model-metadata.ts";
import { DEFAULT_CONTEXT_LIMITS, resolveModelContext } from "../src/context.ts";

const source = {
  lab: { api: "https://lab.example/v1", models: {
    flagship: { name: "Flagship", limit: { context: 262_144, input: 200_000, output: 128_000 }, apiKey: "must-not-survive-normalization" },
  } },
  gateway: { api: "https://gateway.example/v1", models: {
    flagship: { canonical_model_id: "lab/flagship", limit: { context: 131_072, output: 16_384 } },
  } },
};
const catalog = parseModelMetadata(source);

describe("Models.dev metadata", () => {
  it("retains separate limits and drops unrelated or malformed fields", () => {
    expect(catalog.lab.models.flagship).toEqual({ id: "flagship", name: "Flagship", limit: { context: 262_144, input: 200_000, output: 128_000 } });
    expect(JSON.stringify(catalog)).not.toContain("must-not-survive");
    expect(() => parseModelMetadata({ bad: { models: { bad: { limit: { context: -1, output: "128" } } } } })).toThrow();
    expect(() => parseModelMetadata([])).toThrow();
    const polluted = parseModelMetadata(JSON.parse('{"__proto__":{"models":{"constructor":{"limit":{"context":1000}}}}}'));
    expect(Object.getPrototypeOf(polluted)).toBeNull();
    expect(Object.getPrototypeOf(polluted.__proto__.models)).toBeNull();
  });

  it("uses exact provider endpoints before canonical lab limits", () => {
    expect(findModelMetadata(catalog, { name: "My gateway", type: "openai-compatible", baseURL: "https://gateway.example/v1/" }, { id: "flagship", name: "Alias" })?.limit.context).toBe(131_072);
    expect(findModelMetadata(catalog, { name: "Custom", type: "openai-compatible" }, { id: "flagship", name: "Flagship" })?.limit.context).toBe(262_144);
    expect(findModelMetadata(catalog, { name: "Custom" }, { id: "wire-alias", name: "Alias", catalogId: "gateway/flagship" })?.limit.context).toBe(131_072);
    expect(findModelMetadata(catalog, { name: "Custom" }, { id: "lab/flagship", name: "Namespaced" })?.limit.context).toBe(262_144);
    expect(findModelMetadata(catalog, { name: "Custom" }, { id: "flagship-fast", name: "Different model" })).toBeUndefined();
    expect(findModelMetadata(catalog, { name: "Custom" }, { id: "flagship", name: "Broken explicit mapping", catalogId: "missing/model" })).toBeUndefined();
  });

  it("does not infer a canonical model when exact ids conflict across providers", () => {
    const ambiguous = parseModelMetadata({ ...source, other: { models: { flagship: { canonical_model_id: "another/flagship", limit: { context: 1000 } } } } });
    expect(findModelMetadata(ambiguous, { name: "Unknown gateway" }, { id: "flagship", name: "Flagship" })).toBeUndefined();
  });
});

describe("automatic context resolution", () => {
  const model = { id: "flagship", name: "Flagship" };
  const metadata = catalog.lab.models.flagship;
  it("uses catalog capacity while reserving the normal output budget instead of the entire output ceiling", () => {
    expect(resolveModelContext(model, metadata)).toEqual({ contextWindow: 262_144, maxInputTokens: 200_000, reserveOutputTokens: DEFAULT_CONTEXT_LIMITS.reserveOutputTokens });
    expect(resolveModelContext(model, { ...metadata, limit: { context: 8192, output: 1024 } }).reserveOutputTokens).toBe(1024);
  });
  it("honors each manual field and preserves legacy window overrides", () => {
    expect(resolveModelContext({ ...model, contextWindow: 300_000, maxInputTokens: 250_000, maxOutputTokens: 8192 }, metadata)).toEqual({ contextWindow: 300_000, maxInputTokens: 250_000, reserveOutputTokens: 8192 });
    expect(resolveModelContext({ ...model, maxInputTokens: 64_000 }, metadata).contextWindow).toBe(64_000);
    expect(resolveModelContext({ ...model, contextWindow: -1 }, metadata).contextWindow).toBe(262_144);
    expect(resolveModelContext(model)).toEqual(DEFAULT_CONTEXT_LIMITS);
  });
});
