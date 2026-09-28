import { describe, expect, it } from "bun:test";
import { edit, editorLines, graphemes, cleanTerminalText, INPUT_LIMIT } from "../src/editor.ts";
import { filterItems, modelItems, nextModel } from "../src/selection.ts";
import { shortcut } from "../src/keybindings.ts";
import { messagesToItems } from "../src/state.ts";

const keys = { ctrl: false, meta: false, shift: false, tab: false, pageUp: false, pageDown: false };
describe("terminal interaction logic", () => {
  it("edits grapheme clusters without splitting emoji or accented text", () => {
    const state = edit({ text: "", cursor: 0 }, { type: "insert", text: "A👩‍💻é中" });
    expect(state.cursor).toBe(4);
    expect(edit(state, { type: "backspace" }).text).toBe("A👩‍💻é");
    expect(edit({ ...state, cursor: 1 }, { type: "delete" }).text).toBe("Aé中");
    expect(graphemes("👩‍💻")).toHaveLength(1);
  });
  it("bounds pasted input and rejects terminal control sequences", () => {
    expect(cleanTerminalText("\x1b]52;c;c2VjcmV0\x07ok\x1b[2J\r\nnext")).toBe("ok\nnext");
    const state = edit({ text: "", cursor: 0 }, { type: "insert", text: "a".repeat(INPUT_LIMIT - 1) + "😀" });
    expect(state.text.length).toBe(INPUT_LIMIT - 1);
    expect(edit(state, { type: "insert", text: "b" }).text.length).toBe(INPUT_LIMIT);
  });
  it("applies line editing to the current line only", () => {
    const state = { text: "first\nsecond last", cursor: 12 };
    expect(edit(state, { type: "home" }).cursor).toBe(6);
    expect(edit(state, { type: "end" }).cursor).toBe(17);
    expect(edit(state, { type: "killStart" }).text).toBe("first\n last");
    expect(edit({ text: "one two", cursor: 7 }, { type: "killWord" }).text).toBe("one ");
    expect(edit({ text: "a\nb", cursor: 0 }, { type: "home" }).cursor).toBe(0);
    expect(edit({ text: "abc\nx\nlast", cursor: 8 }, { type: "up" }).cursor).toBe(5);
    expect(edit({ text: "abc\nx\nlast", cursor: 1 }, { type: "down" }).cursor).toBe(5);
  });
  it("keeps a long pasted draft within the viewport and places a CJK cursor by cell width", () => {
    const text = "中".repeat(300);
    const lines = editorLines({ text, cursor: 300 }, 20, 5);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)?.cursor).toBe(" ");
    expect(lines[0].before).toHaveLength(10);
    expect(editorLines({ text: "a\nb", cursor: 1 }, 20, 5)[0].cursor).toBe(" ");
  });
  it("groups models without confusing duplicate names or slash-containing ids", () => {
    const items = modelItems({ providers: [
      { name: "Z gateway", models: [{ name: "Same", id: "org/model" }] },
      { name: "Anthropic", models: [{ name: "Same", id: "claude" }] },
    ] }, "Z gateway/org/model");
    expect(items.map(item => item.group)).toEqual(["Anthropic", "Z gateway"]);
    expect(filterItems(items, "gateway org/model")[0]?.current).toBe(true);
    expect(filterItems(items, "unknown")).toHaveLength(0);
    expect(nextModel(items, items[1].value, 1)).toBe(items[0].value);
    expect(nextModel([], "", -1)).toBeUndefined();
  });
  it("resolves Pi shortcuts with portable reverse cycling and no plain-letter collisions", () => {
    expect(shortcut("p", { ...keys, ctrl: true })).toBe("nextModel");
    expect(shortcut("p", { ...keys, meta: true })).toBe("previousModel");
    expect(shortcut("", { ...keys, tab: true, shift: true })).toBe("effort");
    expect(shortcut("l", keys)).toBeUndefined();
    expect(shortcut("t", { ...keys, ctrl: true })).toBe("thinking");
  });
  it("restores conversation rows without exposing system instructions", () => {
    expect(messagesToItems([{ role: "system", content: "secret prompt" }, { role: "user", content: "hello" }, { role: "assistant", content: "answer" }]).map(item => item.kind)).toEqual(["user", "assistant"]);
  });
});
