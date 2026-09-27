import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  executeTool,
  type ToolApprovalRequest,
} from "@ringko-ai/harness";
import { createListDirTool, createReadFileTool, createWriteFileTool } from "./filesystem.ts";
import { createWorkspace } from "./workspace.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ringko-tools-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const never = async (): Promise<boolean> => {
  throw new Error("Safe tools must not request approval.");
};

describe("workspace file tools", () => {
  it("reads a workspace file without approval", async () => {
    await writeFile(join(dir, "a.txt"), "hello");
    const tool = createReadFileTool(createWorkspace(dir));

    const output = await executeTool(tool, { path: "a.txt" }, never);

    expect(output).toEqual({ path: "a.txt", content: "hello" });
  });

  it("fails closed when reading outside the workspace with no approval handler", async () => {
    const tool = createReadFileTool(createWorkspace(dir));

    await expect(executeTool(tool, { path: join(dir, "..", "outside.txt") })).rejects.toBeInstanceOf(
      ApprovalHandlerUnavailableError,
    );
  });

  it("creates a new workspace file without approval", async () => {
    let asked = false;
    const tool = createWriteFileTool(createWorkspace(dir));

    const output = await executeTool(tool, { path: "new.txt", content: "hi" }, async () => {
      asked = true;
      return true;
    });

    expect(asked).toBe(false);
    expect(output.bytes).toBe(2);
    expect(await readFile(join(dir, "new.txt"), "utf8")).toBe("hi");
  });

  it("requires approval before overwriting an existing file", async () => {
    await writeFile(join(dir, "a.txt"), "old");
    const tool = createWriteFileTool(createWorkspace(dir));

    await expect(executeTool(tool, { path: "a.txt", content: "new" })).rejects.toBeInstanceOf(
      ApprovalHandlerUnavailableError,
    );

    let request: ToolApprovalRequest | undefined;
    await executeTool(tool, { path: "a.txt", content: "new" }, async (value) => {
      request = value;
      return true;
    });

    expect(request?.riskLevel).toBe("medium");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("new");
  });

  it("treats a traversal write as external and does not create the file", async () => {
    const tool = createWriteFileTool(createWorkspace(dir));

    await expect(executeTool(tool, { path: "../escape.txt", content: "x" })).rejects.toBeInstanceOf(
      ApprovalHandlerUnavailableError,
    );
    await expect(readFile(join(dir, "..", "escape.txt"), "utf8")).rejects.toThrow();
  });

  it("does not apply a risky write when approval is denied", async () => {
    await writeFile(join(dir, "a.txt"), "old");
    const tool = createWriteFileTool(createWorkspace(dir));

    await expect(executeTool(tool, { path: "a.txt", content: "new" }, async () => false)).rejects.toBeInstanceOf(
      ToolApprovalRejectedError,
    );
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("old");
  });

  it("lists a workspace directory in sorted order", async () => {
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "b.txt"), "x");
    const tool = createListDirTool(createWorkspace(dir));

    const output = await executeTool(tool, { path: "." }, never);

    expect(output.entries.map((entry) => entry.name)).toEqual(["b.txt", "sub"]);
    expect(output.entries.find((entry) => entry.name === "sub")?.kind).toBe("directory");
  });
});
