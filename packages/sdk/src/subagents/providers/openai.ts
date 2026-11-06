import type { ModelClient } from "@ringko-ai/harness";
import type {
  SubagentCatalogEntry,
  SubagentProvider,
  SubagentProviderContext,
  SubagentRunHandle,
  SubagentStartInput,
} from "../types.ts";
import { InProcessProvider } from "./in-process.ts";

export type OpenAiProtocol = "responses" | "chat";
export type OpenAiAuth = "api-key" | "oauth";

export interface OpenAiProviderOptions {
  name?: string;
  description?: string;
  /** Default model id; every run may select another id from `models`. */
  model: string;
  /** Allowed model ids; defaults to `[model]`. */
  models?: string[];
  /** Responses API (default) or Chat Completions. */
  protocol?: OpenAiProtocol;
  /** API key (default) or ChatGPT OAuth credentials. OAuth supports responses only. */
  auth?: OpenAiAuth;
  /** Specific OpenAI OAuth account id; defaults to the saved default account. */
  oauthAccount?: string;
  /** Custom gateway base URL, e.g. `https://api.openai.com/v1`. */
  baseURL?: string;
  /** Explicit API key; defaults to `apiKeyEnv` or the provider environment. */
  apiKey?: string;
  /** Environment variable read for the API key; defaults to `OPENAI_API_KEY`. */
  apiKeyEnv?: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxTurns?: number;
  timeoutMs?: number;
}

/**
 * OpenAI-backed child agent. Both OpenAI routes share the same durable
 * in-process child lifecycle (tools, approvals, continuation, cold resume);
 * only the model transport changes:
 *
 * - `responses`: the OpenAI Responses API (API key or ChatGPT OAuth).
 * - `chat`: OpenAI Chat Completions through the compatible provider.
 */
export class OpenAiProvider implements SubagentProvider {
  readonly kind = "openai";
  readonly name: string;
  readonly description: string;
  readonly modelIds: readonly string[];
  readonly capabilities = Object.freeze({
    continuable: true,
    resume: true,
    modelSelection: true,
    tools: true,
    approvals: true,
  });
  private readonly inner: InProcessProvider;

  constructor(private readonly options: OpenAiProviderOptions) {
    if (typeof options.model !== "string" || options.model.trim().length === 0) throw new TypeError("OpenAI subagent provider requires a model.");
    if (options.protocol !== undefined && options.protocol !== "responses" && options.protocol !== "chat") throw new TypeError("OpenAI protocol must be responses or chat.");
    if (options.auth !== undefined && options.auth !== "api-key" && options.auth !== "oauth") throw new TypeError("OpenAI auth must be api-key or oauth.");
    if (options.auth === "oauth" && options.protocol === "chat") throw new TypeError("OpenAI OAuth supports the responses protocol only.");
    if (options.models !== undefined && (!Array.isArray(options.models) || options.models.length === 0 || options.models.some(model => typeof model !== "string" || !model))) {
      throw new TypeError("OpenAI subagent models must be a non-empty string array.");
    }
    this.name = options.name ?? "openai";
    this.description = options.description ?? "OpenAI API child with the two built-in transports (Responses or Chat Completions).";
    this.modelIds = Object.freeze([...(options.models ?? [options.model])]);
    this.inner = new InProcessProvider({
      name: this.name,
      description: this.description,
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  private async client(model: string): Promise<ModelClient> {
    if (!this.modelIds.includes(model)) throw new Error(`Model "${model}" is not configured for subagent provider "${this.name}".`);
    const protocol = this.options.protocol ?? "responses";
    const auth = this.options.auth ?? "api-key";
    const apiKey = this.options.apiKey ?? (this.options.apiKeyEnv ? process.env[this.options.apiKeyEnv] : process.env.OPENAI_API_KEY);
    const { createProviderClient } = await import("@ringko-ai/providers");
    if (protocol === "responses") {
      return createProviderClient({
        provider: auth === "oauth" ? "openai-oauth" : "openai",
        model,
        ...(auth === "oauth" && this.options.oauthAccount ? { accountId: this.options.oauthAccount } : {}),
        ...(auth === "api-key" && this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
        ...(auth === "api-key" && apiKey ? { apiKey } : {}),
        ...(this.options.temperature !== undefined ? { temperature: this.options.temperature } : {}),
        ...(this.options.maxOutputTokens !== undefined ? { maxOutputTokens: this.options.maxOutputTokens } : {}),
      });
    }
    return createProviderClient({
      provider: "openai-compatible",
      name: this.name,
      model,
      baseURL: this.options.baseURL ?? "https://api.openai.com/v1",
      ...(apiKey ? { apiKey } : {}),
      ...(this.options.temperature !== undefined ? { temperature: this.options.temperature } : {}),
      ...(this.options.maxOutputTokens !== undefined ? { maxOutputTokens: this.options.maxOutputTokens } : {}),
    });
  }

  async start(input: SubagentStartInput & { cwd: string }, context: SubagentProviderContext): Promise<SubagentRunHandle> {
    const modelId = input.model ?? this.options.model;
    return this.inner.start(input, {
      ...context,
      model: await this.client(modelId),
      models: this.modelIds,
      resolveModel: id => this.client(id),
    });
  }

  async resume(entry: SubagentCatalogEntry, context: SubagentProviderContext): Promise<SubagentRunHandle> {
    return this.inner.resume(entry, {
      ...context,
      model: await this.client(entry.model ?? this.options.model),
      models: this.modelIds,
      resolveModel: id => this.client(id),
    });
  }
}
