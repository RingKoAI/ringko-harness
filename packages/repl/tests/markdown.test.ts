import { expect, it } from "bun:test";
import { markdownToAnsi, MARKDOWN_LIMITS } from "../src/markdown.ts";
import { transcriptLines } from "../src/transcript-layout.ts";
import stringWidth from "string-width";

it("emphasizes headings and inline spans", () => {
  const out = markdownToAnsi("# Title\n\nplain **bold** and *italic* and `code`");
  expect(out).toContain("\u001b[1m\u001b[4mTitle\u001b[24m\u001b[22m");
  expect(out).toContain("\u001b[1mbold\u001b[22m");
  expect(out).toContain("\u001b[3mitalic\u001b[23m");
  expect(out).toContain("\u001b[36mcode\u001b[39m");
  expect(out).toContain("plain ");
});

it("renders code fences with a gutter and preserves inner lines", () => {
  const out = markdownToAnsi("```ts\nconst a = 1;\nconst b = 2;\n```");
  expect(out).toBe("\u001b[2m│ \u001b[22m\u001b[36mconst a = 1;\u001b[39m\n\u001b[2m│ \u001b[22m\u001b[36mconst b = 2;\u001b[39m");
});

it("renders lists and blockquotes", () => {
  const out = markdownToAnsi("- one\n- two\n\n> quoted");
  expect(out).toContain("\u001b[36m• \u001b[39mone");
  expect(out).toContain("\u001b[36m• \u001b[39mtwo");
  expect(out).toContain("\u001b[2m│ \u001b[22m\u001b[2mquoted\u001b[22m");
});

it("leaves plain text unchanged", () => {
  expect(markdownToAnsi("just a sentence")).toBe("just a sentence");
});

it("removes untrusted terminal commands while retaining generated emphasis", () => {
  const output = markdownToAnsi("\x1b[2J# Safe\n\n\x1b]52;c;payload\x07**bold**\x07");
  expect(output).not.toContain("\x1b[2J");
  expect(output).not.toContain("payload");
  expect(output).not.toContain("\x07");
  expect(output).toContain("\x1b[1mbold\x1b[22m");
});

it("renders nested links, task lists and table contents", () => {
  const output = markdownToAnsi("[**label**](https://example.com)\n\n- [x] finished\n- [ ] pending\n\n| A | B |\n|---|---|\n| one | two |");
  expect(output).toContain("\x1b[1mlabel");
  expect(output).toContain("https://example.com");
  expect(output).toContain("[x] ");
  expect(output).toContain("[ ] ");
  expect(output).toContain("one | two");
});

it("wraps styled CJK output by terminal cells and preserves failed status", () => {
  const rows = transcriptLines([{ id: 1, kind: "assistant", text: "**中文中文中文中文**", failed: true }], 6, false, false);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.every(row => stringWidth(row.text) <= 6 && row.failed === true)).toBe(true);
  expect(rows.map(row => row.text).join("\n")).toContain("\x1b[1m");
});

it("bounds excessive input and handles deep block nesting", () => {
  expect(markdownToAnsi("x".repeat(MARKDOWN_LIMITS.characters + 1))).toContain("[Markdown display truncated]");
  expect(markdownToAnsi("> ".repeat(100) + "deep")).toContain("deep");
});
