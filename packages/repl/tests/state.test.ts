import { describe, expect, it } from "bun:test";
import { agentEventToItems, truncate } from "../src/state.ts";

describe("agentEventToItems", () => {
  it("emits assistant text", () => {
    const items = agentEventToItems({ type: "model", turn: 1, message: { role: "assistant", content: "hi" } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "assistant", text: "hi" });
  });

  it("skips an empty assistant turn", () => {
    expect(agentEventToItems({ type: "model", turn: 1, message: { role: "assistant", content: "" } })).toEqual([]);
  });

  it("emits tool results and errors", () => {
    const ok = agentEventToItems({
      type: "tool",
      turn: 1,
      message: { role: "tool", content: "ok", name: "read_file" },
      toolName: "read_file",
    });
    expect(ok[0]).toMatchObject({ kind: "tool", text: "ok", toolName: "read_file", failed: false });

    const failed = agentEventToItems({
      type: "tool_error",
      turn: 1,
      message: { role: "tool", content: "denied", name: "run_shell" },
    });
    expect(failed[0]).toMatchObject({ kind: "tool", failed: true });
  });
});

describe("truncate", () => {
  it("collapses whitespace and bounds length", () => {
    expect(truncate("a\n  b", 10)).toBe("a b");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("xy", 4)).toBe("xy");
  });
});
