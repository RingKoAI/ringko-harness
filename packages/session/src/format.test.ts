import { describe, expect, it } from "bun:test";
import { parseEventLine, parseHeaderLine, parseHeaderOnly, parseLog, serializeEvent, serializeHeader } from "./format.ts";

const header = { id: "s1", version: 1, createdAt: 1000, cwd: "/home/me" };

describe("header lines", () => {
  it("round-trips", () => {
    expect(parseHeaderLine(serializeHeader(header).trimEnd())).toEqual(header);
  });

  it("rejects malformed headers", () => {
    expect(parseHeaderLine("{}")).toBeUndefined();
    expect(parseHeaderLine('{"type":"session","id":"","version":1,"createdAt":1}')).toBeUndefined();
    expect(parseHeaderLine("not json")).toBeUndefined();
  });

  it("reads only the header", () => {
    const text = serializeHeader(header) + serializeEvent({ type: "x", seq: 0, time: 1 });
    expect(parseHeaderOnly(text)).toEqual(header);
  });
});

describe("event lines", () => {
  it("round-trips data and ignorable", () => {
    const line = serializeEvent({ type: "tool/call", seq: 3, time: 50, data: { name: "read_file" }, ignorable: true });
    expect(parseEventLine(line.trimEnd())).toEqual({
      type: "tool/call",
      seq: 3,
      time: 50,
      data: { name: "read_file" },
      ignorable: true,
    });
  });

  it("rejects malformed events", () => {
    expect(parseEventLine('{"type":"x","seq":-1,"time":1}')).toBeUndefined();
    expect(parseEventLine('{"type":"x","seq":0}')).toBeUndefined();
  });
});

describe("parseLog", () => {
  it("parses header and contiguous events", () => {
    const text =
      serializeHeader(header) +
      serializeEvent({ type: "a", seq: 0, time: 1 }) +
      serializeEvent({ type: "b", seq: 1, time: 2 });
    const parsed = parseLog(text);
    expect(parsed.header).toEqual(header);
    expect(parsed.events.map((event) => event.type)).toEqual(["a", "b"]);
    expect(parsed.tornTail).toBe(false);
  });

  it("ignores a torn trailing line", () => {
    const text =
      serializeHeader(header) +
      serializeEvent({ type: "a", seq: 0, time: 1 }) +
      '{"type":"b","seq":1,"ti';
    const parsed = parseLog(text);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.tornTail).toBe(true);
  });

  it("rejects non-contiguous sequences", () => {
    const text = serializeHeader(header) + serializeEvent({ type: "a", seq: 5, time: 1 });
    expect(() => parseLog(text)).toThrow("Non-contiguous");
  });

  it("rejects a newer format version", () => {
    const text = serializeHeader({ ...header, version: 99 }) + serializeEvent({ type: "a", seq: 0, time: 1 });
    expect(() => parseLog(text)).toThrow("newer than supported");
  });
});
