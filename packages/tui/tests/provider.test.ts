import { describe, expect, it } from "bun:test";
import type { RingkoConfig } from "@ringko-ai/config";
import {
  baseUrlFromChatUrl,
  loadProviderModel,
  resolveProviderConfig,
  type ProviderImporter,
} from "../src/provider.ts";

describe("baseUrlFromChatUrl", () => {
  it("strips the chat-completions path", () => {
    expect(baseUrlFromChatUrl("https://api.example.com/v1/chat/completions")).toBe("https://api.example.com/v1");
    expect(baseUrlFromChatUrl("https://api.example.com/v1/completions")).toBe("https://api.example.com/v1");
  });
});

describe("resolveProviderConfig", () => {
  it("defaults to echo", () => {
    expect(resolveProviderConfig(undefined).provider).toBe("echo");
  });

  it("maps an openai-compatible selection", () => {
    const options = resolveProviderConfig({
      provider: { name: "gw", type: "openai-compatible", baseURL: "https://h/v1", apiKey: "secret" },
      model: { name: "Model", id: "m" },
    });
    expect(options).toMatchObject({
      provider: "openai-compatible",
      name: "gw",
      baseURL: "https://h/v1",
      apiKey: "secret",
      model: "m",
    });
  });

  it("derives a base URL from a model's chat URL", () => {
    const options = resolveProviderConfig({
      provider: { name: "gw", type: "openai-compatible" },
      model: { name: "Model", id: "m", url: "https://gateway.example.com/v1/chat/completions" },
    });
    expect(options.baseURL).toBe("https://gateway.example.com/v1");
  });

  it("maps the oauth provider type", () => {
    const options = resolveProviderConfig({
      provider: { name: "openai", type: "openai-oauth" },
      model: { name: "GPT-6 Sol", id: "gpt-6-sol" },
    });
    expect(options.provider).toBe("openai-oauth");
    expect(options.model).toBe("gpt-6-sol");
  });
});

describe("loadProviderModel", () => {
  it("uses the offline echo provider by default", async () => {
    const model = await loadProviderModel({});
    expect(typeof model).toBe("function");
  });

  it("imports the configured module and calls its factory", async () => {
    const seen: unknown[] = [];
    const importer: ProviderImporter = async (specifier) => {
      seen.push(specifier);
      return {
        createProviderClient: (options: unknown) => {
          seen.push(options);
          return async () => ({ content: "ok", toolCalls: [] });
        },
      };
    };
    const config: RingkoConfig = {
      model: "gw/m",
      providers: [
        {
          name: "gw",
          type: "openai-compatible",
          baseURL: "https://h/v1",
          module: "my-module",
          models: [{ id: "m", name: "Model" }],
        },
      ],
    };

    const model = await loadProviderModel(config, {}, importer);
    expect(typeof model).toBe("function");
    expect(seen[0]).toBe("my-module");
    expect(seen[1]).toMatchObject({ provider: "openai-compatible", baseURL: "https://h/v1", model: "m" });
  });

  it("reports a module that cannot be imported", async () => {
    const importer: ProviderImporter = async () => {
      throw new Error("boom");
    };
    const config: RingkoConfig = {
      providers: [{ name: "openai", type: "openai", module: "nope", models: [{ id: "m", name: "M" }] }],
    };
    const result = await loadProviderModel(config, {}, importer);
    expect(result).toContain('Cannot load provider module "nope"');
    expect(result).toContain("boom");
  });

  it("reports a module without a factory", async () => {
    const config: RingkoConfig = {
      providers: [{ name: "openai", type: "openai", models: [{ id: "m", name: "M" }] }],
    };
    const result = await loadProviderModel(config, {}, async () => ({}));
    expect(result).toContain("does not export a createProviderClient factory");
  });

  it("reports factory errors", async () => {
    const importer: ProviderImporter = async () => ({
      createProviderClient: () => {
        throw new Error("bad provider");
      },
    });
    const config: RingkoConfig = {
      providers: [{ name: "custom", type: "openai-compatible", baseURL: "https://h/v1", models: [{ id: "m", name: "M" }] }],
    };
    const result = await loadProviderModel(config, {}, importer);
    expect(result).toBe("bad provider");
  });
});
