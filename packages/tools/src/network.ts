import type { ToolDefinition } from "@ringko-ai/harness";

export interface FetchUrlInput {
  url: string;
  method: string;
}

export interface FetchUrlOutput {
  url: string;
  status: number;
  body: string;
}

export interface FetchUrlOptions {
  /** Maximum response body length retained, in characters. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_000_000;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function parseFetchInput(value: unknown): FetchUrlInput {
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
  let method = "GET";
  if (record.method !== undefined) {
    if (typeof record.method !== "string" || record.method.trim().length === 0) {
      throw new TypeError("Expected a non-empty string 'method'.");
    }
    method = record.method.trim().toUpperCase();
  }
  return { url: parsed.toString(), method };
}

/** Perform an outbound HTTP(S) request; classified as medium risk (approval). */
export function createFetchUrlTool(options: FetchUrlOptions = {}): ToolDefinition<FetchUrlInput, FetchUrlOutput> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return {
    name: "fetch_url",
    description: "Perform an outbound HTTP(S) request. Requires approval.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, method: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    parseInput: parseFetchInput,
    assessRisk({ url }) {
      return { kind: "network", reason: `Outbound network request to ${url}.`, target: url };
    },
    async execute({ url, method }) {
      const response = await fetch(url, { method, redirect: "manual" });
      const text = await response.text();
      return {
        url,
        status: response.status,
        body: text.length > maxBytes ? text.slice(0, maxBytes) : text,
      };
    },
  };
}
