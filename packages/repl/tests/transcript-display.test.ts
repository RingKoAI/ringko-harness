import { describe, expect, it } from "bun:test";
import stringWidth from "string-width";
import { cleanTerminalText, editorViewport } from "../src/editor.ts";
import { hintLine } from "../src/chrome.ts";
import { transcriptGroups } from "../src/transcript-groups.ts";
import { createTranscriptRenderer, transcriptLines, TRANSCRIPT_LIMITS } from "../src/transcript-layout.ts";
import { transcriptViewport } from "../src/transcript-viewport.ts";
import type { ReplItem } from "../src/state.ts";

const tool = (id: number, name: string, overrides: Partial<ReplItem> = {}): ReplItem => ({ id, kind: "tool", toolName: name, arguments: { path: `file-${id}.ts` }, text: "result", ...overrides });
const textOf = (lines: ReturnType<typeof transcriptLines>) => cleanTerminalText(lines.map(line => line.text).join("\n"));

describe("compact transcript projection", () => {
  it("groups adjacent exploration without mutating calls, and expands every original call", () => {
    const items = [tool(1, "read"), tool(2, "read"), tool(3, "grep")];
    expect(transcriptGroups(items)[0].items.map(item => item.id)).toEqual([1, 2, 3]);
    const compact = textOf(transcriptLines(items, 80, false, false));
    expect(compact).toContain("Explored · 2 reads · 1 search");
    expect(compact).not.toContain("result");
    const expanded = textOf(transcriptLines(items, 80, false, true));
    for (const id of [1, 2, 3]) expect(expanded).toContain(`file-${id}.ts`);
    expect(expanded.match(/Output:/g)).toHaveLength(3);
    expect(items.every(item => item.text === "result")).toBe(true);
  });

  it("keeps errors, unknown outcomes, writes, shell and message boundaries out of exploration groups", () => {
    const items: ReplItem[] = [tool(1, "read"), tool(2, "grep", { failed: true, text: "denied" }), tool(3, "read", { incomplete: true }), tool(4, "write"), tool(5, "shell"), { id: 6, kind: "assistant", text: "answer" }, tool(7, "read")];
    expect(transcriptGroups(items)).toHaveLength(items.length);
    const text = textOf(transcriptLines(items, 80, false, false));
    expect(text).toContain("Failed");
    expect(text).toContain("denied");
    expect(text).toContain("Outcome unknown");
    expect(text).not.toContain("Explored");
  });

  it("reports exploration as running only when an actual member is running", () => {
    const items = [tool(1, "read"), tool(2, "grep", { running: true, text: "" })];
    expect(textOf(transcriptLines(items, 80, false, false))).toContain("Exploring");
    expect(textOf(transcriptLines(items.map(item => ({ ...item, running: false })), 80, false, false))).toContain("Explored");
  });

  it("bounds expanded output without losing the stored result and sanitizes control sequences", () => {
    const item = tool(1, "custom", { text: "x".repeat(TRANSCRIPT_LIMITS.toolPreview + 100) + "\x1b]52;c;payload\x07" });
    const text = textOf(transcriptLines([item], 80, false, true));
    expect(text).toContain("Display preview truncated");
    expect(text).not.toContain("\x1b");
    expect(item.text.length).toBeGreaterThan(TRANSCRIPT_LIMITS.toolPreview);
  });

  it("fits CJK, styled Markdown, and user prefixes in narrow physical rows", () => {
    const items: ReplItem[] = [{ id: 1, kind: "user", text: "中文 👩‍💻 ".repeat(8) }, { id: 2, kind: "assistant", text: "**中文** ".repeat(12) }, tool(3, "read")];
    for (const width of [12, 40, 80]) {
      for (const line of transcriptLines(items, width, false, true)) expect(stringWidth(line.text)).toBeLessThanOrEqual(width);
    }
  });

  it("reuses completed block layouts across snapshots and invalidates on content and width changes", () => {
    const render = createTranscriptRenderer();
    const first: ReplItem = { id: 1, kind: "assistant", text: "stable answer" };
    const initial = render([first], 80, false, false)[0];
    const snapshot = render([{ ...first }, { id: 2, kind: "assistant", text: "stream" }], 80, false, false);
    expect(snapshot[0]).toBe(initial);
    expect(render([{ ...first, text: "changed" }], 80, false, false)[0]).not.toBe(initial);
    expect(render([first], 40, false, false)[0]).not.toBe(initial);
  });
});

describe("anchored transcript history", () => {
  const message = (count: number): ReplItem => ({ id: 1, kind: "assistant", text: Array.from({ length: count }, (_, index) => `line-${index}`).join("\n") });

  it("pins the same historical rows during stream growth and returns to the latest on demand", () => {
    const before = transcriptViewport(transcriptLines([message(30)], 80, false, false), 6, 80, 10, "main");
    const after = transcriptViewport(transcriptLines([message(40)], 80, false, false), 6, 80, before.offset, "main", before);
    expect(after.page.map(line => line.text)).toEqual(before.page.map(line => line.text));
    expect(after.pending).toBe(true);
    expect(after.offset).toBe(before.offset + 10);
    const earlier = transcriptViewport(transcriptLines([message(40)], 80, false, false), 6, 80, after.offset + 2, "main", after);
    expect(earlier.pending).toBe(true);
    const latest = transcriptViewport(transcriptLines([message(40)], 80, false, false), 6, 80, 0, "main", after);
    expect(latest.offset).toBe(0);
    expect(latest.pending).toBe(false);
    expect(latest.page.at(-1)?.text).toContain("line-39");
  });

  it("preserves a message anchor on resize and keeps task views separate", () => {
    const items: ReplItem[] = Array.from({ length: 8 }, (_, id) => ({ id, kind: "assistant", text: `message-${id} ${"word ".repeat(30)}` }));
    const before = transcriptViewport(transcriptLines(items, 80, false, false), 8, 80, 6, "main");
    const resized = transcriptViewport(transcriptLines(items, 40, false, false), 8, 40, before.offset, "main", before);
    expect(resized.anchor?.itemId).toBe(before.anchor?.itemId);
    expect(resized.pending).toBe(false);
    const task = transcriptViewport(transcriptLines([{ id: 1, kind: "assistant", text: "child" }], 40, false, false), 8, 40, 0, "child", resized);
    expect(textOf([...task.page])).toContain("child");
    expect(task.offset).toBe(0);
  });

  it("keeps tool output anchors distinct from heading and input sections", () => {
    const items = [tool(1, "shell", { text: Array.from({ length: 30 }, (_, index) => `output-${index}`).join("\n") })];
    const before = transcriptViewport(transcriptLines(items, 80, false, true), 6, 80, 10, "main");
    const after = transcriptViewport(transcriptLines(items, 80, false, true), 6, 80, before.offset, "main", before);
    expect(after.page.map(line => line.text)).toEqual(before.page.map(line => line.text));
    expect(textOf([...after.page])).toContain("output-");
  });

  it("keeps the top row stable when status chrome changes height and the page includes separators", () => {
    const items: ReplItem[] = [{ id: 1, kind: "assistant", text: "first\nsecond\nthird\nfourth" }, { id: 2, kind: "user", text: "next" }, { ...message(30), id: 3 }];
    const lines = transcriptLines(items, 80, false, false);
    const before = transcriptViewport(lines, 5, 80, lines.length - 5, "main");
    const after = transcriptViewport(lines, 6, 80, before.offset, "main", before);
    expect(after.page[0].text).toBe(before.page[0].text);
    expect(after.page.length).toBe(before.page.length + 1);
  });

  it("retains the history anchor while a tall modal temporarily covers the transcript", () => {
    const lines = transcriptLines([message(40)], 80, false, false);
    const before = transcriptViewport(lines, 6, 80, 10, "main");
    const hidden = transcriptViewport(lines, 0, 80, before.offset, "main", before);
    const restored = transcriptViewport(lines, 6, 80, hidden.offset, "main", hidden);
    expect(restored.page.map(line => line.text)).toEqual(before.page.map(line => line.text));
  });
});

it("reports hidden editor rows without discarding the complete draft", () => {
  const text = Array.from({ length: 20 }, (_, index) => `draft-${index}`).join("\n");
  const view = editorViewport({ text, cursor: text.length }, 40, 3);
  expect(view.lines).toHaveLength(3);
  expect(view.above).toBeGreaterThan(0);
  expect(view.below).toBe(0);
  const top = editorViewport({ text, cursor: 0 }, 40, 3);
  expect(top.above).toBe(0);
  expect(top.below).toBeGreaterThan(0);
});

it("fits whole shortcut hints and rejects terminal-control injection", () => {
  expect(hintLine(["Enter send", "Alt+Enter newline", "Esc close"], 22)).toBe("Enter send · Esc close");
  expect(hintLine(["\x1b[2JEnter send"], 12)).toBe("Enter send");
  expect(hintLine(["Enter send"], 2)).toBe("");
});
