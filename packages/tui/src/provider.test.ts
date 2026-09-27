import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseUrlFromChatUrl, loadProviderModel, resolveProviderConfig, type ProviderImporter } from "./provider.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ringko-provider-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

  it("maps an inline custom endpoint", () => {
    const options = resolveProviderConfig({
      name: "openai-compatible",
      baseURL: "https://api.example.com/v1",
      apiKey: "secret",
      model: "some/model",
    });
    expect(options).toMatchObject({
      provider: "openai-compatible",
      baseURL: "https://api.example.com/v1",
      apiKey: "secret",
      model: "some/model",
    });
  });

  it("reads a VS Code-style providers file entry", () => {
    // Values are placeholders: never commit a real endpoint or key.
    const file = join(dir, "chatLanguageModels.json");
    writeFileSync(
      file,
      JSON.stringify([
        {
          name: "MyGateway",
          vendor: "customendpoint",
          apiKey: "test-key",
          apiType: "chat-completions",
          models: [{ id: "vendor/model-a", url: "https://gateway.example.com/v1/chat/completions" }],
        },
      ]),
    );

    const options = resolveProviderConfig({ file, entry: "MyGateway", model: "vendor/model-a" }, dir);

    expect(options).toMatchObject({
      provider: "openai-compatible",
      model: "vendor/model-a",
      name: "MyGateway",
      apiKey: "test-key",
      baseURL: "https://gateway.example.com/v1",
    });
  });
});

describe("loadProviderModel", () => {
  it("uses the offline echo provider by default", async () => {
    const model = await loadProviderModel(undefined);
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

    const model = await loadProviderModel(
      { name: "openai-compatible", baseURL: "https://h/v1", model: "m", module: "my-module" },
      importer,
    );

    expect(typeof model).toBe("function");
    expect(seen[0]).toBe("my-module");
    expect(seen[1]).toMatchObject({ provider: "openai-compatible", baseURL: "https://h/v1", model: "m" });
  });

  it("reports a module that cannot be imported", async () => {
    const importer: ProviderImporter = async () => {
      throw new Error("boom");
    };
    const result = await loadProviderModel({ name: "openai", model: "x", module: "nope" }, importer);
    expect(result).toContain('Cannot load provider module "nope"');
    expect(result).toContain("boom");
  });

  it("reports a module without a factory", async () => {
    const result = await loadProviderModel({ name: "openai", model: "x" }, async () => ({}));
    expect(result).toContain("does not export a createProviderClient factory");
  });

  it("reports factory errors", async () => {
    const importer: ProviderImporter = async () => ({
      createProviderClient: () => {
        throw new Error("bad provider");
      },
    });
    const result = await loadProviderModel({ name: "custom", model: "x" }, importer);
    expect(result).toBe("bad provider");
  });
});
