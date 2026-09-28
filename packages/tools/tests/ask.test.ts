import { describe, expect, it } from "bun:test";
import { executeTool } from "@ringko-ai/harness";
import { createAskTool, type AskInput } from "../src/ask.ts";

const question: AskInput = {
  questions: [
    {
      id: "cleanup",
      question: "Proceed?",
      options: [{ label: "Yes" }, { label: "No" }],
    },
  ],
};

describe("ask", () => {
  it("returns the handler's answers", async () => {
    const tool = createAskTool(async (input) => {
      expect(input.questions[0]?.id).toBe("cleanup");
      return { answers: [{ id: "cleanup", selected: ["Yes"] }] };
    });

    const output = await executeTool(tool, question, async () => {
      throw new Error("ask must not request approval");
    });

    expect(output.answers).toEqual([{ id: "cleanup", selected: ["Yes"] }]);
  });

  it("fails closed when the handler rejects", async () => {
    const tool = createAskTool(async () => {
      throw new Error("no user-questions answerer accepted the request");
    });
    await expect(executeTool(tool, question, async () => true)).rejects.toThrow("no user-questions answerer");
  });

  it("rejects an answer that does not match the question", async () => {
    const tool = createAskTool(async () => ({ answers: [{ id: "other", selected: ["Yes"] }] }));
    await expect(executeTool(tool, question, async () => true)).rejects.toThrow("does not match");
  });

  it("rejects an unknown option and a multi selection on a single question", async () => {
    const unknown = createAskTool(async () => ({ answers: [{ id: "cleanup", selected: ["Maybe"] }] }));
    await expect(executeTool(unknown, question, async () => true)).rejects.toThrow("unknown option");

    const multi = createAskTool(async () => ({ answers: [{ id: "cleanup", selected: ["Yes", "No"] }] }));
    await expect(executeTool(multi, question, async () => true)).rejects.toThrow("only one selection");
  });

  it("rejects empty or duplicate questions", async () => {
    const tool = createAskTool(async () => ({ answers: [] }));
    await expect(executeTool(tool, { questions: [] }, async () => true)).rejects.toThrow("non-empty");
    await expect(
      executeTool(
        tool,
        {
          questions: [
            { id: "same", question: "one" },
            { id: "same", question: "two" },
          ],
        },
        async () => true,
      ),
    ).rejects.toThrow("Duplicate");
  });
});
