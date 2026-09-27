import { describe, expect, it } from "bun:test";
import {
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  ToolRegistry,
  executeTool,
  type ToolDefinition,
} from "./tools.ts";

interface Input {
  value: string;
}

function parseInput(value: unknown): Input {
  if (
    typeof value !== "object" ||
    value === null ||
    !("value" in value) ||
    typeof value.value !== "string"
  ) {
    throw new TypeError("Expected a string value.");
  }
  return { value: value.value };
}

function makeTool(
  kind: "safe" | "external_file" | "network" | "shell" | "workspace_write",
  execute: (input: Input) => string,
): ToolDefinition<Input, string> {
  return {
    name: "sample_tool",
    description: "A test tool.",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    parseInput,
    assessRisk: () => ({
      kind,
      level: kind === "workspace_write" ? "high" : undefined,
      reason: "Test risk assessment.",
      target: "test-target",
    }),
    execute,
  };
}

describe("tool approval boundary", () => {
  it("executes safe tools without asking for approval", async () => {
    let executed = false;
    const result = await executeTool(
      makeTool("safe", ({ value }) => {
        executed = true;
        return value;
      }),
      { value: "ok" },
      async () => {
        throw new Error("Safe tools must not request approval.");
      },
    );

    expect(result).toBe("ok");
    expect(executed).toBe(true);
  });

  it("does not execute a risky tool without an approval handler", async () => {
    let executed = false;
    const promise = executeTool(
      makeTool("network", () => {
        executed = true;
        return "executed";
      }),
      { value: "request" },
    );

    await expect(promise).rejects.toBeInstanceOf(ApprovalHandlerUnavailableError);
    expect(executed).toBe(false);
  });

  it("only executes a risky tool after explicit approval", async () => {
    let executed = false;
    const requestApproval = async (request: {
      toolName: string;
      riskKind: string;
      riskLevel: string;
      target?: string;
    }) => {
      expect(request.toolName).toBe("sample_tool");
      expect(request.riskKind).toBe("external_file");
      expect(request.riskLevel).toBe("high");
      expect(request.target).toBe("test-target");
      return true;
    };
    const result = await executeTool(
      makeTool("external_file", () => {
        executed = true;
        return "written";
      }),
      { value: "write" },
      requestApproval,
    );

    expect(result).toBe("written");
    expect(executed).toBe(true);
  });

  it("does not execute a risky tool when approval is rejected", async () => {
    let executed = false;
    const promise = executeTool(
      makeTool("shell", () => {
        executed = true;
        return "executed";
      }),
      { value: "command" },
      async () => false,
    );

    await expect(promise).rejects.toBeInstanceOf(ToolApprovalRejectedError);
    expect(executed).toBe(false);
  });

  it("promotes dynamically classified workspace writes to approval-required", async () => {
    let approved = false;
    await executeTool(
      makeTool("workspace_write", ({ value }) => value),
      { value: "overwrite" },
      async (request) => {
        approved = request.riskLevel === "high";
        return approved;
      },
    );

    expect(approved).toBe(true);
  });

  it("validates input before requesting approval", async () => {
    let requested = false;
    const promise = executeTool(
      makeTool("network", ({ value }) => value),
      { value: 42 },
      async () => {
        requested = true;
        return true;
      },
    );

    await expect(promise).rejects.toThrow("Expected a string value.");
    expect(requested).toBe(false);
  });
});

describe("tool registry", () => {
  it("exposes metadata and dispatches calls through the approval gate", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("safe", ({ value }) => value));

    expect(registry.list()).toMatchObject([
      { name: "sample_tool", description: "A test tool.", inputSchema: { type: "object" } },
    ]);
    await expect(registry.call("sample_tool", { value: "ok" })).resolves.toBe("ok");
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("safe", ({ value }) => value));

    expect(() => registry.register(makeTool("safe", ({ value }) => value))).toThrow(
      'A tool named "sample_tool" is already registered.',
    );
  });

  it("rejects calls to unknown tools", async () => {
    const registry = new ToolRegistry();

    await expect(registry.call("missing", {})).rejects.toThrow(
      'No tool is registered with the name "missing".',
    );
  });
});
