import { expect, it } from "bun:test";
import { loopPrompt, parseLoopArgs, promiseText } from "../src/loop.ts";

it("parses a prompt with options, honoring quoted promises", () => {
  const parsed = parseLoopArgs("fix the auth bug --max-iterations 20 --completion-promise 'ALL TESTS PASS'");
  expect(parsed).toEqual({ ok: true, options: { prompt: "fix the auth bug", maxIterations: 20, completionPromise: "ALL TESTS PASS" } });
});

it("defaults to unlimited with no completion promise and rejects invalid input", () => {
  expect(parseLoopArgs("refactor cache")).toEqual({ ok: true, options: { prompt: "refactor cache", maxIterations: 0 } });
  expect(parseLoopArgs("")).toMatchObject({ ok: false });
  expect(parseLoopArgs("--max-iterations 5")).toMatchObject({ ok: false });
  expect(parseLoopArgs("task --max-iterations abc")).toMatchObject({ ok: false });
  expect(parseLoopArgs("task --max-iterations")).toMatchObject({ ok: false });
  expect(parseLoopArgs("task --bogus")).toMatchObject({ ok: false });
});

it("extracts a completion promise and appends the contract to the prompt", () => {
  expect(promiseText("done: <promise>TASK COMPLETE</promise>")).toBe("TASK COMPLETE");
  expect(promiseText("still working")).toBeUndefined();
  const prompt = loopPrompt({ prompt: "build it", maxIterations: 0, completionPromise: "DONE" });
  expect(prompt).toContain("build it");
  expect(prompt).toContain("<promise>DONE</promise>");
  expect(loopPrompt({ prompt: "build it", maxIterations: 0 })).toBe("build it");
});
