import { describe, expect, it } from "bun:test";
import { agentEventToItems, applyAgentEvent, finishPendingTools, messagesToItems, toolInputText, toolResultSummary, truncate } from "../src/state.ts";
import { transcriptLines } from "../src/transcript-layout.ts";

describe("agentEventToItems", () => {
  it("shows the pre-execution event as a running call without a result", () => {
    expect(agentEventToItems({
      type: "tool_call",
      turn: 1,
      message: { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", arguments: {} }] },
    })[0]).toMatchObject({ kind: "tool", running: true, toolCallId: "c1", text: "" });
  });
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

describe("tool transcript", () => {
  it("marks unfinished calls unknown after interruption and session restoration", () => {
    const messages = [{ role: "assistant" as const, content: "", toolCalls: [{ id: "a", name: "read", arguments: {} }] }];
    const live = finishPendingTools(agentEventToItems({ type: "tool_call", turn: 1, message: messages[0] }));
    expect(live[0]).toMatchObject({ running: false, incomplete: true });
    expect(messagesToItems(messages)[0]).toMatchObject({ running: false, incomplete: true });
    expect(transcriptLines(live, 80, false, false).map(line => line.text).join("\n")).toContain("Outcome unknown");
  });
  it("updates concurrent calls in place and hides raw results until expanded", () => {
    let items = applyAgentEvent([], { type: "tool_call", turn: 1, message: { role: "assistant", content: "", toolCalls: [{ id: "a", name: "read", arguments: { path: "one.ts" } }, { id: "b", name: "shell", arguments: { command: "pwd" } }] } });
    const originalId = items[1].id;
    items = applyAgentEvent(items, { type: "tool", turn: 1, message: { role: "tool", content: "PRIVATE RAW OUTPUT", name: "shell", toolCallId: "b" } });
    expect(items).toHaveLength(2);
    expect(items[1].id).toBe(originalId);
    expect(items[0].running).toBe(true);
    expect(items[1].arguments).toEqual({ command: "pwd" });
    const collapsed = transcriptLines(items, 80, false, false).map(line => line.text).join("\n");
    expect(collapsed).toContain("shell (pwd)");
    expect(collapsed).not.toContain("PRIVATE RAW OUTPUT");
    expect(transcriptLines(items, 80, false, true).map(line => line.text).join("\n")).toContain("  PRIVATE RAW OUTPUT");
  });
  it("restores calls, failures and reasoning without duplicate tool output", () => {
    const items = messagesToItems([{ role: "assistant", content: "", reasoning: "planning", toolCalls: [{ id: "a", name: "read", arguments: { path: "one.ts" } }] }, { role: "tool", content: "denied", name: "read", toolCallId: "a" }], [{ type: "tool/result", data: { toolCallId: "a", failed: true } } as never]);
    expect(items.map(item => item.kind)).toEqual(["thinking", "tool"]);
    expect(items[1]).toMatchObject({ failed: true, running: false, text: "denied", arguments: { path: "one.ts" } });
  });
  it("sanitizes terminal controls in expanded output", () => {
    const output = transcriptLines([{ id: 1, kind: "tool", text: "\x1b[2Jhello\x07", toolName: "custom" }], 20, false, true).map(line => line.text).join("\n");
    expect(output).toContain("hello");
    expect(output).not.toContain("\x1b");
    expect(output).not.toContain("\x07");
  });
  it("keeps the failed result visible and shows bounded input only when expanded", () => {
    const item = { id: 1, kind: "tool" as const, text: "permission denied", toolName: "write", arguments: { file_path: "src/main.ts", content: "private input" }, failed: true };
    expect(toolResultSummary(item)).toBe("permission denied");
    expect(transcriptLines([item], 80, false, false).map(line => line.text).join("\n")).not.toContain("private input");
    const expanded = transcriptLines([item], 80, false, true).map(line => line.text).join("\n");
    expect(expanded).toContain("Input:");
    expect(expanded).toContain("private input");
    expect(expanded).toContain("Output:");
    expect(expanded).toContain("permission denied");
    expect(toolInputText({ ...item, arguments: { command: "x".repeat(10000) } })).toContain("[Input preview truncated]");
  });
});

describe("truncate", () => {
  it("collapses whitespace and bounds length", () => {
    expect(truncate("a\n  b", 10)).toBe("a b");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("xy", 4)).toBe("xy");
  });
});
