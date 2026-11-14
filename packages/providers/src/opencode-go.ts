import { createHash, randomUUID } from "node:crypto";
import { OPENCODE_GO, openCodeGoModelsUrl } from "@ringko-ai/config";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelClient } from "@ringko-ai/harness";
import type { LanguageModel } from "ai";
import { createAiSdkModelClient } from "./ai-sdk.ts";
import type { ProviderAdapter, ProviderClientOptions } from "./types.ts";
import { fetchModels } from "./discovery.ts";
const SDK_NAME = "opencodeGo";

/** Console translates all Go text models to this documented compatibility API. */
export function resolveOpenCodeGoModel(options: ProviderClientOptions): LanguageModel {
  const apiKey = options.apiKey ?? process.env[OPENCODE_GO.apiKeyEnv];
  if (!apiKey?.trim()) throw new TypeError("OpenCode Go requires an API key. Use /connect or OPENCODE_API_KEY.");
  if (/[^\x21-\x7e]/.test(apiKey)) throw new TypeError("OpenCode Go API key contains invalid characters.");
  const endpoint = new URL(options.baseURL ?? OPENCODE_GO.baseURL);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new TypeError("OpenCode Go requires an HTTP(S) base URL without credentials, query or fragment.");
  const provider = createOpenAICompatible({
    name: SDK_NAME,
    baseURL: options.baseURL ?? OPENCODE_GO.baseURL,
    apiKey,
    headers: { ...options.headers, "user-agent": OPENCODE_GO.userAgent, "x-opencode-session": randomUUID() },
  });
  return provider.chatModel(options.model);
}

export function createOpenCodeGoClient(options: ProviderClientOptions): ModelClient {
  const client = createAiSdkModelClient(resolveOpenCodeGoModel(options), { ...options, name: SDK_NAME });
  const fallback = randomUUID();
  return async request => {
    // Hash identifiers to keep paths, non-ASCII text and control bytes out of headers.
    const session = createHash("sha256").update(request.sessionId ?? fallback).digest("hex");
    try { return await client({ ...request, headers: { ...request.headers, "user-agent": OPENCODE_GO.userAgent, "x-opencode-session": session } }); }
    catch (error) {
      if (request.signal?.aborted) throw new DOMException("OpenCode Go request cancelled.", "AbortError");
      // Provider error bodies can echo credentials, including truncated/escaped keys.
      const status = error instanceof Error ? /(?:^|\| )status=([45]\d{2})(?: \||$)/.exec(error.message)?.[1] : undefined;
      throw new Error(`OpenCode Go request failed${status ? ` (HTTP ${status})` : ""}. Check the API key, model access, endpoint and quota.`);
    }
  };
}

export default {
  aliases: ["opencodego"],
  resolveModel: resolveOpenCodeGoModel,
  createClient: createOpenCodeGoClient,
  discoveryFallbackMessage: "OpenCode Go discovery failed; using the bundled model list.",
  discoverModels: (input, options) => fetchModels(openCodeGoModelsUrl(input.baseURL), { "user-agent": OPENCODE_GO.userAgent }, true, options.signal),
} satisfies ProviderAdapter;
