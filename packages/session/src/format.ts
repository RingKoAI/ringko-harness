// Session log serialization and parsing.
//
// One JSON object per line: a header line first, then one event per line. A
// file whose last line has no terminating newline is treated as a torn tail
// (an interrupted write) and the partial line is ignored.
import {
  SESSION_FORMAT_VERSION,
  SESSION_HEADER_TYPE,
  type SessionEvent,
  type SessionHeader,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeHeader(header: SessionHeader): string {
  const record: Record<string, unknown> = {
    type: SESSION_HEADER_TYPE,
    id: header.id,
    version: header.version,
    createdAt: header.createdAt,
  };
  if (header.cwd !== undefined) record.cwd = header.cwd;
  if (header.parentSession !== undefined) record.parentSession = header.parentSession;
  if (header.attributes !== undefined) record.attributes = header.attributes;
  return `${JSON.stringify(record)}\n`;
}

export function serializeEvent(event: SessionEvent): string {
  const record: Record<string, unknown> = {
    type: event.type,
    seq: event.seq,
    time: event.time,
  };
  if (event.data !== undefined) record.data = event.data;
  if (event.ignorable) record.ignorable = true;
  return `${JSON.stringify(record)}\n`;
}

export function parseHeaderLine(line: string): SessionHeader | undefined {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(record) || record.type !== SESSION_HEADER_TYPE) return undefined;
  if (typeof record.id !== "string" || record.id.length === 0) return undefined;
  if (typeof record.version !== "number" || !Number.isInteger(record.version) || record.version < 1) {
    return undefined;
  }
  if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) return undefined;
  return {
    id: record.id,
    version: record.version,
    createdAt: record.createdAt,
    ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
    ...(typeof record.parentSession === "string" ? { parentSession: record.parentSession } : {}),
    ...(isRecord(record.attributes) ? { attributes: record.attributes } : {}),
  };
}

export function parseEventLine(line: string): SessionEvent | undefined {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(record)) return undefined;
  if (typeof record.type !== "string" || record.type.length === 0) return undefined;
  if (typeof record.seq !== "number" || !Number.isInteger(record.seq) || record.seq < 0) return undefined;
  if (typeof record.time !== "number" || !Number.isFinite(record.time)) return undefined;
  return {
    type: record.type,
    seq: record.seq,
    time: record.time,
    ...(record.data !== undefined ? { data: record.data } : {}),
    ...(record.ignorable === true ? { ignorable: true } : {}),
  };
}

export interface ParsedLog {
  header: SessionHeader;
  events: SessionEvent[];
  tornTail: boolean;
}

/** Parse a whole session log. Throws on a bad header or discontinuous events. */
export function parseLog(text: string): ParsedLog {
  const lines = text.split("\n");
  let tornTail = false;
  const last = lines[lines.length - 1];
  if (last !== "") {
    // No trailing newline: the final line is a partial (torn) write.
    tornTail = true;
    lines.pop();
  } else {
    lines.pop();
  }
  if (lines.length === 0) throw new Error("Session log is empty.");

  const header = parseHeaderLine(lines[0]);
  if (!header) throw new Error("Session log has an invalid header.");
  if (header.version > SESSION_FORMAT_VERSION) {
    throw new Error(
      `Session format v${header.version} is newer than supported v${SESSION_FORMAT_VERSION}.`,
    );
  }

  const events: SessionEvent[] = [];
  let expected = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "") continue;
    const event = parseEventLine(line);
    if (!event) throw new Error(`Invalid session event at line ${i + 1}.`);
    if (event.seq !== expected) {
      throw new Error(`Non-contiguous session seq at line ${i + 1}: expected ${expected}, got ${event.seq}.`);
    }
    events.push(event);
    expected = event.seq + 1;
  }
  return { header, events, tornTail };
}

/** Read only the header from a log's first line. */
export function parseHeaderOnly(text: string): SessionHeader | undefined {
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  return parseHeaderLine(firstLine);
}
