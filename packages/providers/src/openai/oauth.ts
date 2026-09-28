// OpenAI via ChatGPT OAuth: reuse the Codex backend with a token-injecting
// fetch, so no API key is needed. Mirrors the Codex CLI (originator/User-Agent)
// so requests are not treated as an unknown client.
import { randomUUID } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { applyProxyEnv, getOAuthAccount, updateOAuthCredential, type OAuthCredential } from "@ringko-ai/config";
import {
  CODEX_ORIGINATOR,
  CODEX_RESIDENCY_HEADER,
  OPENAI_CODEX_ENDPOINT,
  codexUserAgent,
  extractResidency,
  refreshOpenAi,
} from "@ringko-ai/auth";
import { copyHeaders } from "../fetch-util.ts";

/** Auth domain the ChatGPT/Codex OAuth accounts live under. */
export const OPENAI_OAUTH_DOMAIN = "openai-oauth";
const PLACEHOLDER_KEY = "ringko-oauth";
const REFRESH_SKEW_MS = 60_000;
const CODEX_RESPONSES_PATH = "/backend-api/codex/responses";

function describeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Only the Responses / chat-completions paths are redirected to the Codex backend. */
function isCodexRouted(pathname: string): boolean {
  return pathname.endsWith("/responses") || pathname.includes("/chat/completions");
}

function resolveCodexTarget(input: RequestInfo | URL): { url: string; rewritten: boolean } {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const parsed = new URL(url);
  if (!isCodexRouted(parsed.pathname)) return { url, rewritten: false };
  const target = new URL(OPENAI_CODEX_ENDPOINT);
  parsed.protocol = target.protocol;
  parsed.host = target.host;
  parsed.port = "";
  parsed.pathname = CODEX_RESPONSES_PATH;
  parsed.search = "";
  parsed.hash = "";
  return { url: parsed.toString(), rewritten: true };
}

/**
 * The Codex backend requires `store: false`; the AI SDK defaults it to true.
 * Force it in the request body. Non-JSON bodies pass through unchanged.
 */
export function withCodexStore(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== "string") return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return body;
  const record = parsed as Record<string, unknown>;
  if (record.store === false) return body;
  record.store = false;
  return JSON.stringify(record);
}

/**
 * A `fetch` that injects (and refreshes) the stored ChatGPT OAuth bearer token,
 * adds the Codex CLI identity headers, and rewrites responses requests to the
 * Codex backend. Concurrent refreshes are de-duplicated.
 */
export function createOpenAiOauthFetch(accountId?: string): typeof fetch {
  let pending: Promise<OAuthCredential> | null = null;
  const sessionId = randomUUID();
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    applyProxyEnv();
    const account = getOAuthAccount(OPENAI_OAUTH_DOMAIN, accountId);
    if (!account) {
      throw new Error('Not signed in to OpenAI. Run "ringko auth login openai-oauth" first.');
    }
    let credential = account.credential;
    if (credential.expires <= Date.now() + REFRESH_SKEW_MS) {
      pending ??= refreshOpenAi(credential.refresh)
        .then((next) => {
          updateOAuthCredential(OPENAI_OAUTH_DOMAIN, account.id, next);
          return next;
        })
        .catch((error: unknown) => {
          throw describeError(error);
        })
        .finally(() => {
          pending = null;
        });
      credential = await pending;
    }

    const headers = copyHeaders(init?.headers);
    headers.delete("authorization");
    headers.set("authorization", `Bearer ${credential.access}`);
    if (credential.accountId) headers.set("chatgpt-account-id", credential.accountId);
    headers.set("originator", CODEX_ORIGINATOR);
    headers.set("user-agent", codexUserAgent());
    // The Codex backend keys on the hyphenated session/thread headers plus the
    // thread-scoped request id; `session_id` (underscore) is not recognized.
    headers.set("session-id", sessionId);
    headers.set("thread-id", sessionId);
    headers.set("x-client-request-id", sessionId);
    headers.set("accept", "text/event-stream");
    const residency = extractResidency(credential.access);
    if (residency) headers.set(CODEX_RESIDENCY_HEADER, residency);

    const target = resolveCodexTarget(input);
    const body = target.rewritten ? withCodexStore(init?.body) : init?.body;
    return fetch(target.url, { ...init, headers, ...(body === undefined ? {} : { body }) });
  };
  // bun-types augments `fetch` with `preconnect`; the AI SDK only needs the
  // call signature, so narrow to the standard `typeof fetch` contract.
  return send as unknown as typeof fetch;
}

/** Resolve an OpenAI model backed by the ChatGPT OAuth (Codex) endpoint. */
export function resolveOpenAiOauthModel(model: string, accountId?: string): LanguageModel {
  const client = createOpenAI({
    apiKey: PLACEHOLDER_KEY,
    baseURL: OPENAI_CODEX_ENDPOINT,
    fetch: createOpenAiOauthFetch(accountId),
  });
  return client.responses(model);
}
