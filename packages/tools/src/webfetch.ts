import { Parser } from "htmlparser2";
import TurndownService from "turndown";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { networkUrl, readBounded, timeoutSignal, WEB_LIMITS } from "./network.ts";

export interface WebFetchInput {
  url: string;
  format: "markdown" | "text" | "html";
  timeout?: number;
}

export interface WebFetchOutput {
  url: string;
  status: number;
  body: string;
  truncated: boolean;
  redirect?: string;
}

export interface WebFetchOptions {
  /** Maximum response bytes retained; defaults to 5 MiB. */
  maxBytes?: number;
  /** Explicit host opt-in for local/intranet development endpoints. */
  allowPrivateHosts?: boolean;
}

const FORMATS = new Set(["markdown", "text", "html"]);

function plainText(html: string): string {
  let text = "";
  let hidden = 0;
  const parser = new Parser({
    onopentag(name) {
      if (hidden || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) hidden++;
      else if (["p", "br", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name)) text += "\n";
    },
    ontext(value) { if (!hidden) text += value; },
    onclosetag() { if (hidden) hidden--; },
  }, { decodeEntities: true });
  parser.end(html);
  return text.replace(/\n[\t ]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Fetch bounded HTTP(S) text with a single approval for the exact assessed URL. */
export function createWebFetchTool(options: WebFetchOptions = {}): ToolDefinition<WebFetchInput, WebFetchOutput> {
  const maxBytes = options.maxBytes ?? WEB_LIMITS.responseBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > WEB_LIMITS.responseBytes) throw new TypeError("Invalid webfetch response limit.");
  return defineTool<WebFetchInput, WebFetchOutput>({
    name: "webfetch",
    description: "Fetch an HTTP(S) URL after approval. Return Markdown (default), plain text or HTML. Redirects are reported but not followed; responses are limited to 5 MiB.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        format: { type: "string", enum: ["markdown", "text", "html"] },
        timeout: { type: "number", minimum: 0, maximum: WEB_LIMITS.maxTimeoutSeconds },
      },
      required: ["url"], additionalProperties: false,
    },
    parseInput(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a webfetch object.");
      const record = value as Record<string, unknown>;
      if (Object.keys(record).some(key => !["url", "format", "timeout"].includes(key))) throw new TypeError("Unexpected webfetch field.");
      if (typeof record.url !== "string") throw new TypeError("Expected a URL string.");
      const url = networkUrl(record.url, options.allowPrivateHosts).toString();
      const format = record.format ?? "markdown";
      if (typeof format !== "string" || !FORMATS.has(format)) throw new TypeError("Invalid webfetch format.");
      const timeout = record.timeout;
      if (timeout !== undefined && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > WEB_LIMITS.maxTimeoutSeconds)) throw new TypeError("Invalid webfetch timeout.");
      return { url, format: format as WebFetchInput["format"], ...(timeout !== undefined ? { timeout: timeout as number } : {}) };
    },
    assessRisk({ url }) { return { kind: "network", reason: `Outbound network request to ${url}.`, target: url }; },
    async execute({ url, format, timeout }, context) {
      const signal = timeoutSignal(timeout, context?.signal);
      const response = await fetch(url, { signal, redirect: "manual", headers: {
        Accept: format === "markdown" ? "text/markdown, text/plain;q=0.9, text/html;q=0.8" : format === "html" ? "text/html, text/plain;q=0.8" : "text/plain, text/html;q=0.8",
      } });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !/^(text\/|application\/(json|xml|xhtml\+xml))/.test(contentType)) {
        await response.body?.cancel();
        throw new Error("Web response is not supported text content.");
      }
      const { text, truncated } = await readBounded(response, maxBytes, signal);
      const html = contentType.includes("html");
      let body = text;
      if (html && format === "text") body = plainText(text);
      if (html && format === "markdown") {
        const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
        converter.remove(["script", "style", "noscript", "iframe", "object", "embed", "meta", "link"]);
        body = converter.turndown(text);
      }
      return { url, status: response.status, body, truncated,
        ...(response.status >= 300 && response.status < 400 && response.headers.has("location") ? { redirect: new URL(response.headers.get("location")!, url).toString() } : {}),
      };
    },
  });
}
