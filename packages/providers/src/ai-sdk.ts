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
import type { ChatMessage, MessagePart, ModelClient, ModelToolCall, ModelTurn, ReasoningDetail, ToolMetadata } from "@ringko-ai/harness";

export interface AiSdkModelOptions {
  /** System instruction applied to every request. */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Provider name; used as the `providerOptions` key. */
  name?: string;
  /** Provider kind (e.g. "google"), for provider-specific options. */
  provider?: string;
  /** Model id, used to select provider-specific replay rules. */
  model?: string;
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

/** How a provider accepts replayed assistant reasoning. */
export type ReasoningReplay = "anthropic" | "google" | "openai" | "text";

/** Pick the replay rule from the configured provider kind. */
export function reasoningReplayFor(provider: string | undefined): ReasoningReplay {
  switch (provider) {
    case "anthropic":
    case "anthropic-oauth":
      return "anthropic";
    case "google":
      return "google";
    case "openai":
    case "openai-oauth":
      return "openai";
    default:
      // openai-compatible, xai-oauth, github-copilot and custom gateways.
      return "text";
  }
}

/**
 * Keep only reasoning the current provider can accept. Anthropic requires a
 * signed thinking block, Google requires its thought signature, and OpenAI
 * reasoning items are provider-specific; a plain text block cannot be replayed
 * across providers. OpenAI-compatible endpoints use `reasoning_content`, so a
 * text fallback is valid there.
 */
function replayReasoning(message: ChatMessage, replay: ReasoningReplay): ReasoningDetail[] {
  const details = message.reasoningDetails ?? [];
  if (replay === "anthropic") {
    return details.filter(detail => detail.providerOptions?.anthropic &&
      (detail.providerOptions.anthropic.signature !== undefined || detail.providerOptions.anthropic.redactedData !== undefined));
  }
  if (replay === "google") {
    return details.filter(detail => detail.providerOptions?.google?.thoughtSignature !== undefined);
  }
  if (replay === "openai") {
    return details.filter(detail => detail.providerOptions?.openai !== undefined);
  }
  // Text providers: native details have no provider options. If the history
  // carries only foreign reasoning blocks, drop them instead of relabelling.
  const native = details.filter(detail => !detail.providerOptions || Object.keys(detail.providerOptions).length === 0);
  if (details.length > 0) return native;
  return message.reasoning && message.reasoning.length > 0 ? [{ text: message.reasoning }] : [];
}

type ToolResultOutput = ToolResultPart["output"];

/** Map harness parts onto the AI SDK's tool-result content blocks. */
function toToolResultOutput(parts: readonly MessagePart[] | undefined, fallback: string): ToolResultOutput {
  if (!parts || parts.length === 0) return { type: "text", value: fallback };
  const value: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; data: { type: "data"; data: string } }> = [];
  for (const part of parts) {
    if (part.type === "text") {
      value.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      value.push({ type: "file", mediaType: part.mediaType, data: { type: "data", data: part.data } });
    }
  }
  return value.length > 0 ? { type: "content", value } : { type: "text", value: fallback };
}

/** Map harness parts onto a user message, keeping the plain-text fast path. */
function toUserContent(content: string, parts: readonly MessagePart[] | undefined): string | Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; data: { type: "data"; data: string } }> {
  if (!parts || parts.length === 0) return content;
  const value: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; data: { type: "data"; data: string } }> = [];
  for (const part of parts) {
    if (part.type === "text") {
      value.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      value.push({ type: "file", mediaType: part.mediaType, data: { type: "data", data: part.data } });
    }
  }
  return value.length > 0 ? value : content;
}

function toolResult(toolCallId: string, toolName: string, value: string, parts?: readonly MessagePart[]): ToolResultPart {
  return { type: "tool-result", toolCallId, toolName, output: toToolResultOutput(parts, value) };
}

/**
 * Map harness chat messages onto AI SDK model messages. Harness stores the
 * assistant's tool calls on the assistant message, so an assistant turn with
 * its following tool results is rebuilt into one assistant message (text +
 * tool-call parts) followed by one tool message (tool-result parts).
 */
export function toModelMessages(
  messages: readonly ChatMessage[],
  options: { reasoningReplay?: ReasoningReplay } = {},
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    switch (message.role) {
      case "system":
        out.push({ role: "system", content: message.content });
        break;
      case "user":
        out.push({ role: "user", content: toUserContent(message.content, message.parts) });
        break;
      case "assistant": {
        const parts: Array<TextPart | ReasoningPart | ToolCallPart> = [];
        const reasoning = options.reasoningReplay
          ? replayReasoning(message, options.reasoningReplay)
          : message.reasoningDetails && message.reasoningDetails.length > 0
            ? message.reasoningDetails
            : message.reasoning && message.reasoning.length > 0 ? [{ text: message.reasoning }] : [];
        for (const detail of reasoning) {
          parts.push({
            type: "reasoning",
            text: detail.text,
            ...(detail.providerOptions ? { providerOptions: detail.providerOptions as Record<string, Record<string, JSONValue>> } : {}),
          });
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
          results.push(toolResult(id, name, call.content, call.parts));
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
          content: [toolResult(message.toolCallId ?? "", message.name ?? "", message.content, message.parts)],
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
type ProviderOptions = Record<string, Record<string, JSONValue>>;

/** Models that reject enabled/disabled thinking and expose `effort` instead. */
const ANTHROPIC_ADAPTIVE = /(?:opus|sonnet|fable)-5|(?:opus|sonnet)-4[.-][6-9]|claude-5[.-][1-9]/i;

/** A thinking budget below the output cap; Anthropic requires at least 1024. */
function thinkingBudget(level: string, maxOutputTokens?: number): number {
  const preferred = level === "max" ? 32_000 : level === "high" ? 16_000 : level === "medium" ? 8_000 : 4_000;
  if (maxOutputTokens === undefined || !Number.isFinite(maxOutputTokens)) return preferred;
  return Math.max(1_024, Math.min(preferred, Math.floor(maxOutputTokens) - 1_024));
}

function anthropicThinking(level: string, model: string, maxOutputTokens?: number): Record<string, JSONValue> {
  if (level === "off") return { thinking: { type: "disabled" } };
  if (ANTHROPIC_ADAPTIVE.test(model)) return { thinking: { type: "adaptive", display: "summarized" }, effort: level };
  return { thinking: { type: "enabled", budgetTokens: thinkingBudget(level, maxOutputTokens) } };
}

/** Map the thinking depth onto Google's `thinkingConfig`. */
function googleThinking(level: string, model: string): Record<string, JSONValue> {
  if (level === "off") return { thinkingBudget: 0, includeThoughts: true };
  if (model.includes("2.5")) {
    const budget = level === "max" ? 24_576 : level === "high" ? 16_000 : level === "medium" ? 8_000 : 4_000;
    return { thinkingBudget: budget, includeThoughts: true };
  }
  return { thinkingLevel: level === "max" ? "high" : level, includeThoughts: true };
}

/**
 * Map the thinking depth onto each provider's own field. Provider option keys
 * must match the name the AI SDK provider was created with, including hyphens.
 */
function reasoningOptions(options: AiSdkModelOptions): { providerOptions?: ProviderOptions } {
  const level = options.thinking;
  if (!level) return {};
  const model = (options.model ?? "").toLowerCase();
  switch (options.provider) {
    case "anthropic":
    case "anthropic-oauth":
      return { providerOptions: { anthropic: anthropicThinking(level, model, options.maxOutputTokens) } };
    case "google":
      return { providerOptions: { google: { thinkingConfig: googleThinking(level, model) } } };
    case "openai":
    case "openai-oauth":
      return { providerOptions: { openai: { reasoningEffort: level === "off" ? "none" : level } } };
    case "xai-oauth":
      return level === "off" ? {} : { providerOptions: { xai: { reasoningEffort: level } } };
    case "github-copilot":
      return level === "off" ? {} : { providerOptions: { "github-copilot": { reasoningEffort: level } } };
    default:
      return level === "off" ? {} : { providerOptions: { [options.name ?? "openaiCompatible"]: { reasoningEffort: level } } };
  }
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
    const messages = toModelMessages(request.messages.filter(message => message.role !== "system"), {
      reasoningReplay: reasoningReplayFor(options.provider),
    });
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
      let delivered = false;
      const consume = async (input: typeof base) => {
        // Errors are propagated below; avoid the SDK logging raw provider bodies.
        const result = streamText({ ...input, onError: () => {} });
        for await (const part of result.fullStream) {
          request.signal?.throwIfAborted();
          if (part.type === "text-delta" || part.type === "reasoning-delta") {
            delivered = true;
            request.onDelta?.({ kind: part.type === "text-delta" ? "text" : "reasoning", text: part.text });
          } else if (part.type === "error") throw part.error;
        }
        return toTurn(await result.text, await result.toolCalls as readonly RawToolCall[], await result.usage, (await result.reasoningText) ?? "", toReasoningDetails(await result.reasoning));
      };
      try {
        return await consume(base);
      } catch (error) {
        if (!delivered && !request.signal?.aborted && options.maxOutputTokens !== undefined && isInvalidParameter(error)) {
          try {
            return await consume({ ...base, maxOutputTokens: undefined });
          } catch (retryError) {
            throw describeModelError(retryError);
          }
        }
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
