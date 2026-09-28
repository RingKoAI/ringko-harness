import { describe, expect, it } from "bun:test";
import {
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  executeTool,
  JobManager,
  type ToolApprovalRequest,
} from "@ringko-ai/harness";
import { createShellTool } from "../src/shell.ts";

const cwd = process.cwd();
const echo = "echo ringko";

describe("shell tool", () => {
  it("streams background output and retrieves its result by job id", async () => {
    const jobs = new JobManager();
    const output = await executeTool(createShellTool({ cwd }), { command: echo, background: true }, async () => true, "approval", { jobs });
    if (!("jobId" in output)) throw new Error("Expected background job id.");
    await jobs.settle();
    const page = await jobs.subscribe({ jobId: output.jobId });
    expect(page.job.status).toBe("completed");
    expect(page.events.some(event => event.type === "stdout")).toBe(true);
    expect(page.job.result).toMatchObject({ exitCode: 0 });
  });

  it("kills a cancelled background process tree and retains bounded output", async () => {
    const jobs = new JobManager();
    const command = process.platform === "win32" ? 'ping -n 30 127.0.0.1 > nul' : 'sleep 30';
    const output = await executeTool(createShellTool({ cwd }), { command, background: true }, async () => true, "approval", { jobs });
    if (!("jobId" in output)) throw new Error("Expected background job id.");
    jobs.cancel(output.jobId); await jobs.settle();
    expect(jobs.get(output.jobId).status).toBe("cancelled");
  }, 5000);

  it("preserves nonzero foreground exit codes and marks the job as failed", async () => {
    const jobs = new JobManager();
    const output = await executeTool(createShellTool({ cwd }), { command: "exit 7" }, async () => true, "approval", { jobs });
    expect(output).toMatchObject({ exitCode: 7 });
    expect(jobs.list()[0].status).toBe("failed");
  });

  it("enforces timeout for a foreground process", async () => {
    const command = process.platform === "win32" ? 'ping -n 30 127.0.0.1 > nul' : 'sleep 30';
    const output = await executeTool(createShellTool({ cwd }), { command, timeout: 30 }, async () => true);
    expect(output).toMatchObject({ timedOut: true });
  }, 5000);
  it("fails closed without an approval handler", async () => {
    const tool = createShellTool({ cwd });
    await expect(executeTool(tool, { command: echo })).rejects.toBeInstanceOf(ApprovalHandlerUnavailableError);
  });

  it("does not execute when approval is denied", async () => {
    const tool = createShellTool({ cwd });
    await expect(executeTool(tool, { command: echo }, async () => false)).rejects.toBeInstanceOf(
      ToolApprovalRejectedError,
    );
  });

  it("runs after approval and reports the exit code", async () => {
    let request: ToolApprovalRequest | undefined;
    const tool = createShellTool({ cwd });
    const output = await executeTool(tool, { command: echo }, async (value) => {
      request = value;
      return true;
    });
    expect(request?.riskLevel).toBe("high");
    if (!("exitCode" in output)) throw new Error("Expected foreground shell result.");
    expect(output.exitCode).toBe(0);
    expect(output.stdout.trim().length).toBeGreaterThan(0);
  });

  it("rejects invalid input before asking for approval", async () => {
    let asked = false;
    const tool = createShellTool({ cwd });
    await expect(
      executeTool(tool, { command: "" }, async () => {
        asked = true;
        return true;
      }),
    ).rejects.toThrow("non-empty command");
    expect(asked).toBe(false);
  });
});
