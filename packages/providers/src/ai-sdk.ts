// Adapt the Vercel AI SDK to the harness ModelClient.
//
// The harness owns the tool loop and the approval gate, so tools are declared
// to the AI SDK without an `execute` function: the SDK returns the tool calls
// and stops, and the harness runs them (or refuses) through its own boundary.
import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type ToolCallPart,
  type ToolResultPart,
} from "ai";
import type { ChatMessage, ModelClient, ModelToolCall, ModelTurn, ReasoningDetail, ToolMetadata } from "@ringko-ai/harness";

export interface AiSdkModelOptions {
  /** System instruction applied to every request. */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Provider name; used as the `providerOptions` key. */
  name?: string;
  /** Provider kind (e.g. "google"), for provider-specific options. */
  provider?: string;
  /** Reasoning/thinking depth: "off" | "low" | "high" | "max". */
  thinking?: string;
  /** Stable cache key for provider-side prompt caching (OpenAI family). */
  cacheKey?: string;
  /**
   * Use the streaming transport. Required by backends that only accept
   * `stream: true` (e.g. the Codex `/responses` endpoint); the client still
   * resolves to a single completion.
   */
  stream?: boolean;
}

interface TextPart {
  type: "text";
  text: string;
}

interface ReasoningPart {
  type: "reasoning";
  text: string;
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

/** Narrow an unknown value to the provider-options record carried by a reasoning block. */
function isProviderOptions(value: unknown): value is Record<string, Record<string, JSONValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep the provider reasoning blocks (text + provider options) for verbatim replay. */
function toReasoningDetails(value: unknown): ReasoningDetail[] {
  if (!Array.isArray(value)) return [];
  const out: ReasoningDetail[] = [];
  for (const part of value) {
    if (typeof part !== "object" || part === null) continue;
    const record = part as { type?: unknown; text?: unknown; providerOptions?: unknown };
    if (record.type !== "reasoning" || typeof record.text !== "string") continue;
    out.push({
      text: record.text,
      ...(isProviderOptions(record.providerOptions) ? { providerOptions: record.providerOptions } : {}),
    });
  }
  return out;
}

function toolResult(toolCallId: string, toolName: string, value: string): ToolResultPart {
  return { type: "tool-result", toolCallId, toolName, output: { type: "text", value } };
}

/**
 * Map harness chat messages onto AI SDK model messages. Harness stores the
 * assistant's tool calls on the assistant message, so an assistant turn with
 * its following tool results is rebuilt into one assistant message (text +
 * tool-call parts) followed by one tool message (tool-result parts).
 */
export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    switch (message.role) {
      case "system":
        out.push({ role: "system", content: message.content });
        break;
      case "user":
        out.push({ role: "user", content: message.content });
        break;
      case "assistant": {
        const parts: Array<TextPart | ReasoningPart | ToolCallPart> = [];
        if (message.reasoningDetails && message.reasoningDetails.length > 0) {
          for (const detail of message.reasoningDetails) {
            parts.push({
              type: "reasoning",
              text: detail.text,
              ...(detail.providerOptions ? { providerOptions: detail.providerOptions as Record<string, Record<string, JSONValue>> } : {}),
            });
          }
        } else if (message.reasoning && message.reasoning.length > 0) {
          parts.push({ type: "reasoning", text: message.reasoning });
        }
        if (message.content.length > 0) {
          parts.push({ type: "text", text: message.content });
        }
        const results: ToolResultPart[] = [];
        let j = i + 1;
        while (j < messages.length && messages[j].role === "tool") {
          const call = messages[j];
          const id = call.toolCallId ?? "";
          const name = call.name ?? "";
          const args = message.toolCalls?.find((entry) => entry.id === id)?.arguments ?? {};
          parts.push({ type: "tool-call", toolCallId: id, toolName: name, input: args });
          results.push(toolResult(id, name, call.content));
          j += 1;
        }
        out.push({ role: "assistant", content: parts.length > 0 ? parts : message.content });
        if (results.length > 0) {
          out.push({ role: "tool", content: results });
        }
        i = j - 1;
        break;
      }
      case "tool":
        // Orphan tool message (no preceding assistant turn).
        out.push({
          role: "tool",
          content: [toolResult(message.toolCallId ?? "", message.name ?? "", message.content)],
        });
        break;
    }
  }
  return out;
}

/** Build an AI SDK tool set (schema only) from harness tool metadata. */
export function toToolSet(metadata: readonly ToolMetadata[]): Record<string, ReturnType<typeof tool>> {
  const set: Record<string, ReturnType<typeof tool>> = {};
  for (const meta of metadata) {
    set[meta.name] = tool({
      description: meta.description,
      inputSchema: jsonSchema(meta.inputSchema as Parameters<typeof jsonSchema>[0]),
    });
  }
  return set;
}

/** Provider usage may be a flat number or a `{ total }` object. */
function tokenCount(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null) {
    const total = (value as { total?: unknown }).total;
    if (typeof total === "number") return total;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Pull `code`/`param`/`type` out of a provider error body, if present. */
function providerErrorFields(body: string): string[] {
  const fields: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fields;
  }
  const outer = asRecord(parsed);
  const error = asRecord(outer?.error) ?? outer;
  if (!error) return fields;
  for (const key of ["code", "param", "type"] as const) {
    const value = error[key];
    if (typeof value === "string" && value.length > 0) fields.push(`${key}=${value}`);
  }
  return fields;
}

/** Turn an AI SDK error into a message that includes the error code and HTTP details. */
function describeModelError(error: unknown): Error {
  const record = asRecord(error);
  if (record) {
    const parts: string[] = [];
    if (typeof record.message === "string" && record.message.length > 0) parts.push(record.message);
    if (typeof record.statusCode === "number") parts.push(`status=${record.statusCode}`);
    if (typeof record.responseBody === "string") parts.push(...providerErrorFields(record.responseBody));
    if (typeof record.url === "string") parts.push(`url=${record.url}`);
    if (typeof record.responseBody === "string") parts.push(`body=${record.responseBody.slice(0, 500)}`);
    if (parts.length > 0) return new Error(parts.join(" | "));
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isInvalidParameter(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { statusCode?: unknown; responseBody?: unknown; message?: unknown };
  if (record.statusCode !== 400) return false;
  const body = typeof record.responseBody === "string" ? record.responseBody : "";
  const message = typeof record.message === "string" ? record.message : "";
  return body.includes("invalid_parameter") || message.includes("invalid_parameter");
}

/** AI SDK expects the provider-options key to be the camelCased provider name. */
function providerOptionsKey(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return name;
  const [first, ...rest] = parts;
  const head = first.charAt(0).toLowerCase() + first.slice(1);
  return head + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

type ProviderOptions = Record<string, Record<string, JSONValue>>;

/** Map the thinking depth onto Google's `thinkingConfig`. */
function googleThinking(level: string): Record<string, JSONValue> {
  if (level === "off") return { thinkingBudget: 0, includeThoughts: true };
  if (level === "max") return { thinkingLevel: "high", includeThoughts: true };
  return { thinkingLevel: level, includeThoughts: true };
}

/** Map the thinking depth onto provider options (reasoning effort). */
function reasoningOptions(options: AiSdkModelOptions): { providerOptions?: ProviderOptions } {
  const level = options.thinking;
  if (options.provider === "google" || options.provider === "google-gemini-cli") {
    if (!level) return {};
    return { providerOptions: { google: { thinkingConfig: googleThinking(level) } } };
  }
  if (!level || level === "off") return {};
  const key = providerOptionsKey(options.name ?? "openaiCompatible");
  return { providerOptions: { [key]: { reasoningEffort: level } } };
}

/** Provider-side prompt caching: Anthropic `cache_control`, OpenAI `prompt_cache_key`. */
function cacheOptions(options: AiSdkModelOptions): { providerOptions?: ProviderOptions } {
  if (options.provider === "anthropic" || options.provider === "anthropic-oauth") {
    return { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } };
  }
  if ((options.provider === "openai" || options.provider === "openai-oauth") && options.cacheKey) {
    return { providerOptions: { openai: { promptCacheKey: options.cacheKey } } };
  }
  return {};
}

/** Merge reasoning + caching options (the same provider key is deep-merged). */
function providerOptionsFor(options: AiSdkModelOptions): { providerOptions?: ProviderOptions } {
  const merged: ProviderOptions = {};
  for (const source of [reasoningOptions(options).providerOptions, cacheOptions(options).providerOptions]) {
    if (!source) continue;
    for (const [provider, values] of Object.entries(source)) merged[provider] = { ...(merged[provider] ?? {}), ...values };
  }
  return Object.keys(merged).length > 0 ? { providerOptions: merged } : {};
}

/** Shape both `generateText` and `streamText` expose for one completed call. */
interface RawToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** Normalize a completed call into a harness turn. */
function toTurn(
  text: string,
  calls: readonly RawToolCall[],
  usage: unknown,
  reasoning: string,
  reasoningDetails: readonly ReasoningDetail[],
): ModelTurn {
  const toolCalls: ModelToolCall[] = calls.map((call) => ({
    id: call.toolCallId,
    name: call.toolName,
    arguments: call.input,
  }));
  const counts = usage as { inputTokens?: unknown; outputTokens?: unknown; inputTokenDetails?: unknown } | undefined;
  const details = (counts?.inputTokenDetails ?? undefined) as
    | { cacheReadTokens?: unknown; cacheWriteTokens?: unknown }
    | undefined;
  const inputTokens = tokenCount(counts?.inputTokens);
  const outputTokens = tokenCount(counts?.outputTokens);
  const cacheReadTokens = tokenCount(details?.cacheReadTokens);
  const cacheWriteTokens = tokenCount(details?.cacheWriteTokens);
  return {
    content: text,
    toolCalls,
    ...(reasoning.length > 0 ? { reasoning } : {}),
    ...(reasoningDetails.length > 0 ? { reasoningDetails } : {}),
    ...(inputTokens !== undefined || outputTokens !== undefined || cacheReadTokens !== undefined || cacheWriteTokens !== undefined
      ? {
          usage: {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
          },
        }
      : {}),
  };
}

/** Adapt any AI SDK language model into a harness model client. */
export function createAiSdkModelClient(model: LanguageModel, options: AiSdkModelOptions = {}): ModelClient {
  return async (request) => {
    // AI SDK v7 accepts system messages through instructions, not the messages array.
    const instructions = [options.system, ...request.messages.filter(message => message.role === "system").map(message => message.content)].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n\n");
    const messages = toModelMessages(request.messages.filter(message => message.role !== "system"));
    const base = {
      model,
      messages,
      ...(request.tools.length > 0 ? { tools: toToolSet(request.tools) } : {}),
      ...(instructions ? { instructions } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
      ...(request.signal ? { abortSignal: request.signal } : {}),
      ...providerOptionsFor(options),
    };

    // Streaming transport: the Codex `/responses` backend rejects `stream: false`.
    if (options.stream || request.onDelta) {
      try {
        const result = streamText(base);
        for await (const part of result.fullStream) {
          request.signal?.throwIfAborted();
          if (part.type === "text-delta") request.onDelta?.({ kind: "text", text: part.text });
          else if (part.type === "reasoning-delta") request.onDelta?.({ kind: "reasoning", text: part.text });
          else if (part.type === "error") throw part.error;
        }
        const text = await result.text;
        const calls = await result.toolCalls;
        const usage = await result.usage;
        const reasoning = (await result.reasoningText) ?? "";
        const reasoningDetails = toReasoningDetails(await result.reasoning);
        return toTurn(text, calls as readonly RawToolCall[], usage, reasoning, reasoningDetails);
      } catch (error) {
        throw describeModelError(error);
      }
    }

    let result;
    try {
      result = await generateText(base);
    } catch (error) {
      // Some compatible gateways reject an explicit max output token value;
      // retry once without it so the request still succeeds.
      if (options.maxOutputTokens !== undefined && isInvalidParameter(error)) {
        try {
          result = await generateText({
            model,
            messages,
            ...(request.tools.length > 0 ? { tools: toToolSet(request.tools) } : {}),
            ...(instructions ? { instructions } : {}),
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(request.signal ? { abortSignal: request.signal } : {}),
            ...providerOptionsFor(options),
          });
        } catch (retryError) {
          throw describeModelError(retryError);
        }
      } else {
        throw describeModelError(error);
      }
    }

    return toTurn(result.text, result.toolCalls as readonly RawToolCall[], result.usage, result.reasoningText ?? "", toReasoningDetails(result.reasoning));
  };
}
