import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalHandlerUnavailableError, executeTool, type ToolApprovalRequest } from "@ringko-ai/harness";
import {
  FileTracker,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
} from "../src/index.ts";
import { createWorkspace } from "../src/workspace.ts";

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

describe("read", () => {
  it("reads a file with line numbers", async () => {
    await writeFile(join(dir, "a.txt"), "one\ntwo\nthree");
    const output = await executeTool(createReadTool(createWorkspace(dir)), { path: "a.txt" }, never);
    expect(output.path).toBe("a.txt");
    expect(output.content).toBe("     1→one\n     2→two\n     3→three");
  });

  it("lists a directory", async () => {
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "b.txt"), "x");
    const output = await executeTool(createReadTool(createWorkspace(dir)), { path: "." }, never);
    expect(output.entries).toEqual(["b.txt", "sub"]);
  });

  it("warns when the file changed since it was last read", async () => {
    const tracker = new FileTracker();
    const read = createReadTool(createWorkspace(dir), tracker);
    await writeFile(join(dir, "a.txt"), "one");
    await executeTool(read, { path: "a.txt" }, never);
    await writeFile(join(dir, "a.txt"), "one two three");
    const again = await executeTool(read, { path: "a.txt" }, never);
    expect(again.notice).toContain("changed since");
  });

  it("fails closed reading outside the workspace", async () => {
    const tool = createReadTool(createWorkspace(dir));
    await expect(executeTool(tool, { path: join(dir, "..", "outside.txt") })).rejects.toBeInstanceOf(
      ApprovalHandlerUnavailableError,
    );
  });
});

describe("write", () => {
  it("creates a new file without approval", async () => {
    let asked = false;
    const output = await executeTool(
      createWriteTool(createWorkspace(dir)),
      { path: "new.txt", content: "hi" },
      async () => (asked = true),
    );
    expect(asked).toBe(false);
    expect(output).toMatchObject({ bytes: 2, created: true });
    expect(await readFile(join(dir, "new.txt"), "utf8")).toBe("hi");
  });

  it("requires approval before overwriting", async () => {
    await writeFile(join(dir, "a.txt"), "old");
    const tool = createWriteTool(createWorkspace(dir));
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
});

describe("edit", () => {
  it("replaces an exact string", async () => {
    await writeFile(join(dir, "a.txt"), "hello world");
    const output = await executeTool(
      createEditTool(createWorkspace(dir)),
      { path: "a.txt", old_string: "world", new_string: "there" },
      async () => true,
    );
    expect(output.replacements).toBe(1);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("hello there");
  });

  it("errors when the string is missing or ambiguous", async () => {
    await writeFile(join(dir, "a.txt"), "x x");
    const tool = createEditTool(createWorkspace(dir));
    await expect(executeTool(tool, { path: "a.txt", old_string: "z", new_string: "y" }, async () => true)).rejects.toThrow(
      "not found",
    );
    await expect(executeTool(tool, { path: "a.txt", old_string: "x", new_string: "y" }, async () => true)).rejects.toThrow(
      "occurs 2 times",
    );
  });
});

describe("glob", () => {
  it("finds files by pattern", async () => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "index.ts"), "");
    await writeFile(join(dir, "readme.md"), "");
    const output = await executeTool(createGlobTool(createWorkspace(dir)), { pattern: "**/*.ts" }, never);
    expect(output.matches).toEqual(["src/index.ts"]);
  });
});

describe("grep", () => {
  it("finds matching lines", async () => {
    await writeFile(join(dir, "a.txt"), "apple\nbanana\napricot");
    const output = await executeTool(createGrepTool(createWorkspace(dir)), { pattern: "^ap" }, never);
    expect(output.matches.map((match) => match.line)).toEqual([1, 3]);
  });
});
