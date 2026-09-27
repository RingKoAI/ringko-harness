import { describe, expect, it } from "bun:test";
import {
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  executeTool,
  type ToolApprovalRequest,
} from "@ringko-ai/harness";
import { createRunShellTool } from "./shell.ts";

const cwd = process.cwd();

describe("run_shell tool", () => {
  it("fails closed without an approval handler", async () => {
    const tool = createRunShellTool({ cwd });

    await expect(
      executeTool(tool, { command: process.execPath, args: ["--version"] }),
    ).rejects.toBeInstanceOf(ApprovalHandlerUnavailableError);
  });

  it("does not execute when approval is denied", async () => {
    const tool = createRunShellTool({ cwd });

    await expect(
      executeTool(tool, { command: process.execPath, args: ["--version"] }, async () => false),
    ).rejects.toBeInstanceOf(ToolApprovalRejectedError);
  });

  it("runs after approval and reports the exit code", async () => {
    let request: ToolApprovalRequest | undefined;
    const tool = createRunShellTool({ cwd });

    const output = await executeTool(tool, { command: process.execPath, args: ["--version"] }, async (value) => {
      request = value;
      return true;
    });

    expect(request?.riskLevel).toBe("high");
    expect(output.exitCode).toBe(0);
    expect(output.stdout.length).toBeGreaterThan(0);
  });

  it("rejects invalid input before asking for approval", async () => {
    let asked = false;
    const tool = createRunShellTool({ cwd });

    await expect(
      executeTool(tool, { command: "" }, async () => {
        asked = true;
        return true;
      }),
    ).rejects.toThrow("non-empty string 'command'");
    expect(asked).toBe(false);
  });
});
