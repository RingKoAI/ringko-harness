import { defineTool, type ToolDefinition } from "@ringko-ai/harness";

export interface WebFetchInput {
  url: string;
}

export interface WebFetchOutput {
  url: string;
  status: number;
  body: string;
}

export interface WebFetchOptions {
  /** Maximum response body length retained, in characters. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_000_000;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function parseWebFetch(value: unknown): WebFetchInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || record.url.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'url'.");
  }
  let parsed: URL;
  try {
    parsed = new URL(record.url);
  } catch {
    throw new TypeError(`Invalid URL "${record.url}".`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new TypeError(`Unsupported URL scheme "${parsed.protocol}" (only http and https are allowed).`);
  }
  return { url: parsed.toString() };
}

/** Fetch a URL over HTTP(S); classified as medium risk (approval). */
export function createWebFetchTool(options: WebFetchOptions = {}): ToolDefinition<WebFetchInput, WebFetchOutput> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return defineTool<WebFetchInput, WebFetchOutput>({
    name: "webfetch",
    description: "Fetch a URL over HTTP(S) and return its body. Requires approval.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    parseInput: parseWebFetch,
    assessRisk({ url }) {
      return { kind: "network", reason: `Outbound network request to ${url}.`, target: url };
    },
    async execute({ url }) {
      const response = await fetch(url, { redirect: "manual" });
      const text = await response.text();
      return { url, status: response.status, body: text.length > maxBytes ? text.slice(0, maxBytes) : text };
    },
  });
}
