import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { networkUrl, readBounded, timeoutSignal, WEB_LIMITS } from "./network.ts";

export interface WebSearchInput {
  query: string;
  numResults?: number;
  livecrawl?: "fallback" | "preferred";
  type?: "auto" | "fast" | "deep";
  contextMaxCharacters?: number;
}

export interface WebSearchOutput {
  query: string;
  provider: "exa" | "parallel";
  content: string;
  truncated: boolean;
}

export interface WebSearchOptions {
  provider?: "exa" | "parallel";
  /** Host-owned override, useful for a private search gateway and local tests. */
  endpoint?: string;
  apiKey?: string;
}

const ENDPOINTS = Object.freeze({ exa: "https://mcp.exa.ai/mcp", parallel: "https://search.parallel.ai/mcp" });
const SEARCH_RESPONSE_BYTES = 1 * 1024 * 1024;
const SEARCH_TIMEOUT_SECONDS = 25;

function resultText(body: string): string | undefined {
  const payloads = body.trim().startsWith("{") ? [body] : body.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => line.slice(6));
  let recognized = false;
  for (const payload of payloads) {
    if (!payload.trim().startsWith("{")) continue;
    let message: unknown;
    try { message = JSON.parse(payload); } catch { throw new Error("Invalid web search response."); }
    if (!message || typeof message !== "object") throw new Error("Invalid web search response.");
    const data = message as { error?: unknown; result?: { content?: unknown } };
    if (data.error) throw new Error("Web search provider returned an error.");
    if (!Array.isArray(data.result?.content)) continue;
    recognized = true;
    const text = data.result.content.filter((entry): entry is { type: "text"; text: string } =>
      !!entry && typeof entry === "object" && entry.type === "text" && typeof entry.text === "string")
      .map(entry => entry.text).join("\n");
    if (text) return text;
  }
  if (!recognized) throw new Error("Invalid web search response.");
  return undefined;
}

/** Search through a fixed provider endpoint; model arguments cannot select a network destination. */
export function createWebSearchTool(options: WebSearchOptions = {}): ToolDefinition<WebSearchInput, WebSearchOutput> {
  const provider = options.provider ?? "exa";
  if (provider !== "exa" && provider !== "parallel") throw new TypeError("Invalid web search provider.");
  const endpoint = networkUrl(options.endpoint ?? ENDPOINTS[provider], options.endpoint !== undefined);
  if (endpoint.protocol !== "https:" && options.endpoint === undefined) throw new TypeError("Search provider requires HTTPS.");
  return defineTool<WebSearchInput, WebSearchOutput>({
    name: "websearch",
    description: "Search the web through Exa (default) or Parallel after approval for the exact query. Result count, crawl mode, depth and context length apply to Exa.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: WEB_LIMITS.queryCharacters },
        numResults: { type: "integer", minimum: 1, maximum: 20 },
        livecrawl: { type: "string", enum: ["fallback", "preferred"] },
        type: { type: "string", enum: ["auto", "fast", "deep"] },
        contextMaxCharacters: { type: "integer", minimum: 1, maximum: 50_000 },
      },
      required: ["query"], additionalProperties: false,
    },
    parseInput(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a websearch object.");
      const input = value as Record<string, unknown>;
      if (Object.keys(input).some(key => !["query", "numResults", "livecrawl", "type", "contextMaxCharacters"].includes(key)) ||
        typeof input.query !== "string" || !input.query.trim() || input.query.length > WEB_LIMITS.queryCharacters ||
        (input.numResults !== undefined && (!Number.isInteger(input.numResults) || (input.numResults as number) < 1 || (input.numResults as number) > 20)) ||
        (input.contextMaxCharacters !== undefined && (!Number.isInteger(input.contextMaxCharacters) || (input.contextMaxCharacters as number) < 1 || (input.contextMaxCharacters as number) > 50_000)) ||
        (input.livecrawl !== undefined && input.livecrawl !== "fallback" && input.livecrawl !== "preferred") ||
        (input.type !== undefined && input.type !== "auto" && input.type !== "fast" && input.type !== "deep")) throw new TypeError("Invalid websearch arguments.");
      return input as unknown as WebSearchInput;
    },
    assessRisk({ query }) { return { kind: "network", reason: `Search the web for: ${query}.`, target: query }; },
    async execute(input, context) {
      const key = options.apiKey ?? process.env[provider === "exa" ? "EXA_API_KEY" : "PARALLEL_API_KEY"];
      if (provider === "parallel" && !key) throw new Error("Set PARALLEL_API_KEY before using Parallel web search.");
      const url = new URL(endpoint);
      if (provider === "exa" && key) url.searchParams.set("exaApiKey", key);
      const args = provider === "exa"
        ? { query: input.query, type: input.type ?? "auto", numResults: input.numResults ?? 8, livecrawl: input.livecrawl ?? "fallback", ...(input.contextMaxCharacters ? { contextMaxCharacters: input.contextMaxCharacters } : {}) }
        : { objective: input.query, search_queries: [input.query] };
      const signal = timeoutSignal(SEARCH_TIMEOUT_SECONDS, context?.signal);
      let response: Response;
      try {
        response = await fetch(url, { method: "POST", signal, redirect: "manual", headers: {
          Accept: "application/json, text/event-stream", "Content-Type": "application/json",
          ...(provider === "parallel" && key ? { Authorization: `Bearer ${key}` } : {}),
        }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: provider === "exa" ? "web_search_exa" : "web_search", arguments: args } }) });
      } catch { context?.signal?.throwIfAborted(); throw new Error("Web search request failed or timed out."); }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 && provider === "exa" && !key) throw new Error("Web search provider returned HTTP 401. Set EXA_API_KEY for Exa search.");
        throw new Error(`Web search provider returned HTTP ${response.status}.`);
      }
      let text: string;
      let truncated: boolean;
      try { ({ text, truncated } = await readBounded(response, SEARCH_RESPONSE_BYTES, signal)); }
      catch { context?.signal?.throwIfAborted(); throw new Error("Web search response failed or timed out."); }
      if (truncated) throw new Error("Web search response exceeds 1 MiB.");
      return { query: input.query, provider, content: resultText(text) ?? "No search results found.", truncated: false };
    },
  });
}
