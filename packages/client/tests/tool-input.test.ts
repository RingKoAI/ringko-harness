import { expect, it } from "bun:test";
import { applyToolInputDelta, TOOL_INPUT_PREVIEW_LIMITS } from "../src/index.ts";

it("bounds tool previews, preserves interleaved ids and rejects late or malformed deltas", () => {
  let state = applyToolInputDelta([], { kind: "start", id: "a", name: "write" });
  state = applyToolInputDelta(state, { kind: "start", id: "b", name: "read" });
  state = applyToolInputDelta(state, { kind: "delta", id: "b", text: '{"path":' });
  state = applyToolInputDelta(state, { kind: "delta", id: "a", text: "x".repeat(TOOL_INPUT_PREVIEW_LIMITS.characters + 1) });
  expect(state[0].text.length).toBe(TOOL_INPUT_PREVIEW_LIMITS.characters); expect(state[0].truncated).toBe(true);
  state = applyToolInputDelta(state, { kind: "end", id: "a" }); const previous = state;
  for (const value of [null, {}, { kind: "delta", id: "a", text: "late" }, { kind: "delta", id: "missing", text: "ignored" }, { kind: "start", id: "a", name: "duplicate" }]) expect(applyToolInputDelta(state, value)).toEqual(previous);
  expect(state[1].text).toBe('{"path":');
  for (let index = state.length; index < TOOL_INPUT_PREVIEW_LIMITS.calls + 1; index++) state = applyToolInputDelta(state, { kind: "start", id: String(index), name: "read" });
  expect(state).toHaveLength(TOOL_INPUT_PREVIEW_LIMITS.calls);
});
