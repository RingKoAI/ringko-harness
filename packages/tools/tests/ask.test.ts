import { describe, expect, it } from "bun:test";
import { executeTool } from "@ringko-ai/harness";
import { AskManager, createAskTool, ASK_LIMITS, type AskInput, type AskEvent } from "../src/ask.ts";

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
  it("serializes parent/child questions and keeps invalid answers pending", async () => {
    const events: AskEvent[] = [];
    const manager = new AskManager(event => events.push(event));
    const first = manager.request(question);
    const second = manager.request(question);
    expect(events.map(event => event.type)).toEqual(["requested"]);
    const id = events[0].id;
    expect(() => manager.respond(id, { answers: [{ id: "cleanup", selected: ["Invalid"] }] })).toThrow("unknown option");
    expect(events).toHaveLength(1);
    manager.respond(id, { answers: [{ id: "cleanup", selected: ["Yes"] }] });
    expect(await first).toMatchObject({ answers: [{ selected: ["Yes"] }] });
    expect(events.map(event => event.type)).toEqual(["requested", "answered", "requested"]);
    manager.respond(events[2].id, { answers: [{ id: "cleanup", selected: [], custom: "Use a different scope" }] });
    expect(await second).toMatchObject({ answers: [{ custom: "Use a different scope" }] });
  });

  it("cancels queued questions and bounds untrusted prompts and answers", async () => {
    const events: AskEvent[] = [];
    const manager = new AskManager(event => events.push(event));
    const controller = new AbortController();
    const pending = executeTool(createAskTool(manager.request), question, undefined, "approval", { signal: controller.signal });
    await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toThrow();
    expect(events.at(-1)?.type).toBe("cancelled");
    const tool = createAskTool(async () => ({ answers: [{ id: "cleanup", selected: [], custom: "x".repeat(ASK_LIMITS.answerCharacters + 1) }] }));
    await expect(executeTool(tool, question)).rejects.toThrow("custom");
    await expect(executeTool(tool, { questions: Array.from({ length: 5 }, (_, index) => ({ id: `q${index}`, question: "Which?" })) })).rejects.toThrow();
  });
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
