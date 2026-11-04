import { getApiKey, loadConfig, saveConfig, upsertProviderModels, type RingkoConfig } from "@ringko-ai/config";
import { discoverProviderModels } from "../../provider.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

const KNOWN_PROVIDER_TYPES = new Set(["openai", "openai-oauth", "anthropic", "google", "github-copilot", "xai-oauth", "openai-compatible"]);

/** Discover a provider's models (live or catalog) and persist them to provider.json. */
export async function syncModels(providerName: string, fallbackType: string, io: CliIo): Promise<number> {
  let config: RingkoConfig;
  try {
    config = loadConfig({});
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid config.");
    return 2;
  }
  const provider = (config.providers ?? []).find((entry) => entry.name === providerName);
  // Infer an OAuth provider type when the provider is not yet in provider.json.
  const oauthType =
    providerName === "github-copilot"
      ? "github-copilot"
      : providerName === "xai" || providerName === "grok" || providerName === "xai-oauth"
        ? "xai-oauth"
        : providerName === "openai" || providerName === "openai-oauth"
          ? "openai-oauth"
          : undefined;
  const knownType = KNOWN_PROVIDER_TYPES.has(providerName) ? providerName : undefined;
  const type = provider?.type ?? provider?.vendor ?? oauthType ?? knownType ?? fallbackType;
  const apiKey = provider?.apiKey ?? getApiKey(providerName);
  const discovered = await discoverProviderModels({
    type,
    ...(provider?.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    providerId: providerName,
  });
  if (typeof discovered === "string") {
    io.err(discovered);
    return 1;
  }
  const models = discovered;
  if (models.length === 0) {
    io.out(`no models found for ${providerName}.`);
    return 0;
  }
  saveConfig(upsertProviderModels(config, providerName, type, models));
  for (const model of models) io.out(model.id);
  io.out(`${models.length} model(s) added for ${providerName}.`);
  return 0;
}

export async function modelsCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const requested: string | undefined = parsed.positionals[0];
  let name: string | undefined = requested;
  if (!name) {
    try {
      const config = loadConfig({});
      const selected = config.model ?? "";
      const slash = selected.indexOf("/");
      name = slash > 0 ? selected.slice(0, slash) : config.providers?.[0]?.name;
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Invalid config.");
      return 2;
    }
  }
  if (!name) {
    io.err("models requires a provider name; none configured.");
    return 2;
  }
  return syncModels(name, "openai-compatible", io);
}
