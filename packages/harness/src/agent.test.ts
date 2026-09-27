import { describe, expect, it } from "bun:test";
import { Agent, AgentTurnLimitError, type ModelClient } from "./agent.ts";
import { ToolRegistry, type ToolDefinition } from "./tools.ts";

function echoTool(kind: "safe" | "shell"): ToolDefinition<{ text: string }, string> {
  return {
    name: "echo",
    description: "Return the given text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    parseInput(value) {
      if (
        typeof value !== "object" ||
        value === null ||
        !("text" in value) ||
        typeof value.text !== "string"
      ) {
        throw new TypeError("Expected text.");
      }
      return { text: value.text };
    },
    assessRisk: () => ({ kind, reason: "Test tool." }),
    execute: ({ text }) => text,
  };
}

describe("agent harness", () => {
  it("returns a final model response without calling tools", async () => {
    const model: ModelClient = async (request) => {
      expect(request.messages.at(-1)?.content).toBe("hello");
      expect(request.tools).toHaveLength(1);
      return { content: "hi", toolCalls: [] };
    };
    const tools = new ToolRegistry();
    tools.register(echoTool("safe"));

    const result = await new Agent({ model, tools }).run("hello");

    expect(result.content).toBe("hi");
    expect(result.turns).toBe(1);
  });

  it("feeds a tool result back to the model and then finishes", async () => {
    let calls = 0;
    const model: ModelClient = async (request) => {
      calls += 1;
      if (calls === 1) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "pong" } }],
        };
      }
      expect(request.messages.at(-1)).toMatchObject({
        role: "tool",
        content: "pong",
        toolCallId: "call-1",
      });
      return { content: "done", toolCalls: [] };
    };
    const tools = new ToolRegistry();
    tools.register(echoTool("safe"));

    const result = await new Agent({ model, tools }).run("ping");

    expect(result.content).toBe("done");
    expect(result.turns).toBe(2);
  });

  it("returns a tool failure to the model instead of executing past the gate", async () => {
    let asked = false;
    const model: ModelClient = async (request) => {
      if (request.messages.filter((message) => message.role === "tool").length === 0) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "rm" } }],
        };
      }
      return { content: request.messages.at(-1)?.content ?? "", toolCalls: [] };
    };
    const tools = new ToolRegistry();
    tools.register(echoTool("shell"));

    const result = await new Agent({
      model,
      tools,
      requestApproval: async (request) => {
        asked = true;
        expect(request.toolName).toBe("echo");
        return false;
      },
    }).run("do it");

    expect(asked).toBe(true);
    expect(result.content).toContain("Approval was not granted");
  });

  it("stops when the model never finishes", async () => {
    const model: ModelClient = async () => ({ content: "", toolCalls: [] });
    const looping: ModelClient = async () => ({
      content: "",
      toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "again" } }],
    });
    const tools = new ToolRegistry();
    tools.register(echoTool("safe"));

    await expect(new Agent({ model: looping, tools, maxTurns: 2 }).run("loop")).rejects.toBeInstanceOf(
      AgentTurnLimitError,
    );
    await expect(new Agent({ model, tools }).run("   ")).rejects.toThrow("must not be empty");
  });
});
