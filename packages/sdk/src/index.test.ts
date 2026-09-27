import { describe, expect, it } from "bun:test";
import { createRingKo, type ModelClient, type ToolDefinition } from "./index.ts";

const echo: ToolDefinition<{ text: string }, string> = {
  name: "echo",
  description: "Return the given text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  parseInput(value) {
    if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") {
      throw new TypeError("Expected text.");
    }
    return { text: value.text };
  },
  assessRisk: () => ({ kind: "safe", reason: "Echo is safe." }),
  execute: ({ text }) => text,
};

describe("RingKo SDK facade", () => {
  it("exposes the access mode", () => {
    const ringko = createRingKo({ model: async () => ({ content: "ok", toolCalls: [] }) });
    expect(ringko.access.id).toBe("approval");
  });

  it("runs a tool call and returns the final turn", async () => {
    const model: ModelClient = async (request) => {
      if (request.messages.some((message) => message.role === "tool")) {
        return { content: "done", toolCalls: [] };
      }
      return { content: "", toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "hi" } }] };
    };
    const ringko = createRingKo({ model });
    ringko.register(echo);

    const result = await ringko.run("go");

    expect(result.content).toBe("done");
    expect(result.turns).toBe(2);
  });

  it("rejects a missing model client", () => {
    expect(() => createRingKo({ model: undefined as unknown as ModelClient })).toThrow(
      "RingKo requires a model client.",
    );
  });
});
