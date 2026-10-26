import { recordSessionSummary, recordSessionTitle, recordSessionUsage } from "@ringko-ai/session";
import type { ChatMessage, ModelClient } from "./index.ts";

export interface SessionMeta {
  title?: string;
  summary?: string;
}

/** Any handle that accepts session events and can flush them (e.g. a SessionHandle). */
export type SessionMetaTarget = Parameters<typeof recordSessionTitle>[0] & { flush(): void };

export interface SessionMetaOptions {
  /** Most recent messages considered; defaults to 24. */
  maxMessages?: number;
  /** Total transcript characters considered; defaults to 12000. */
  maxCharacters?: number;
}

const DEFAULT_MAX_MESSAGES = 24;
const DEFAULT_MAX_CHARACTERS = 12_000;
const MAX_TITLE_CHARACTERS = 80;
const MAX_SUMMARY_CHARACTERS = 400;

const SYSTEM_PROMPT =
  "You label an agent conversation. Reply with strict JSON only: " +
  '{"title": string, "summary": string}. ' +
  "title: a 3-6 word human-readable name, no trailing period. " +
  "summary: one or two sentences describing what the user wanted and the outcome. " +
  "Do not include quotes, newlines, or markdown inside the values.";

/** A bounded, single-line-per-message transcript for the summarizer prompt. */
function transcript(messages: readonly ChatMessage[], limit: number, maxCharacters: number): string {
  const lines: string[] = [];
  let size = 0;
  for (const message of messages.filter(entry => entry.role === "user" || entry.role === "assistant").slice(-limit)) {
    const text = message.content.replace(/\s+/g, " ").trim();
    if (text.length === 0) continue;
    const line = `${message.role === "user" ? "User" : "Assistant"}: ${text}`;
    if (size + line.length > maxCharacters) {
      lines.push(line.slice(0, Math.max(0, maxCharacters - size)));
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
}

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, max) : undefined;
}

/** Parse `{ title, summary }` from a model reply, tolerating fenced JSON. */
function parseMeta(content: string): SessionMeta | undefined {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed.slice(start, end + 1)); } catch { return undefined; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const title = clean(record.title, MAX_TITLE_CHARACTERS);
  const summary = clean(record.summary, MAX_SUMMARY_CHARACTERS);
  return title || summary ? { ...(title ? { title } : {}), ...(summary ? { summary } : {}) } : undefined;
}

/**
 * Generate a session title and summary from the conversation and persist them as
 * session events. Best-effort: failures, empty conversations and unparseable
 * replies return undefined without throwing, so callers can fire-and-forget.
 */
export async function generateSessionMeta(
  model: ModelClient,
  messages: readonly ChatMessage[],
  session: SessionMetaTarget,
  options: SessionMetaOptions = {},
): Promise<SessionMeta | undefined> {
  const text = transcript(messages, options.maxMessages ?? DEFAULT_MAX_MESSAGES, options.maxCharacters ?? DEFAULT_MAX_CHARACTERS);
  if (text.length === 0) return undefined;
  try {
    const started = performance.now();
    const turn = await model({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      tools: [],
    });
    if (turn.usage && recordSessionUsage(session, turn.usage, undefined, { kind: "metadata", durationMs: performance.now() - started })) session.flush();
    const meta = parseMeta(turn.content);
    if (!meta) return undefined;
    if (meta.title) recordSessionTitle(session, meta.title);
    if (meta.summary) recordSessionSummary(session, meta.summary);
    session.flush();
    return meta;
  } catch {
    return undefined;
  }
}
