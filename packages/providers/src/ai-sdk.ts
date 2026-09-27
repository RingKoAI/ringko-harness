// Adapt the Vercel AI SDK to the harness ModelClient.
//
// The harness owns the tool loop and the approval gate, so tools are declared
// to the AI SDK without an `execute` function: the SDK returns the tool calls
// and stops, and the harness runs them (or refuses) through its own boundary.
import {
  generateText,
  jsonSchema,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolCallPart,
  type ToolResultPart,
} from "ai";
import type { ChatMessage, ModelClient, ModelToolCall, ModelTurn, ToolMetadata } from "@ringko-ai/harness";

export interface AiSdkModelOptions {
  /** System instruction applied to every request. */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

interface TextPart {
  type: "text";
  text: string;
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
        const parts: Array<TextPart | ToolCallPart> = [];
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

/** Adapt any AI SDK language model into a harness model client. */
export function createAiSdkModelClient(model: LanguageModel, options: AiSdkModelOptions = {}): ModelClient {
  return async (request) => {
    const result = await generateText({
      model,
      messages: toModelMessages(request.messages),
      ...(request.tools.length > 0 ? { tools: toToolSet(request.tools) } : {}),
      ...(options.system !== undefined ? { system: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    });

    const toolCalls: ModelToolCall[] = result.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      arguments: call.input,
    }));
    const turn: ModelTurn = { content: result.text, toolCalls };
    return turn;
  };
}
