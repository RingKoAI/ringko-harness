import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { TodoItem } from "@ringko-ai/tools";
import { TodoPanel } from "../src/components/TodoPanel.tsx";

async function display(todos: readonly TodoItem[], columns = 80): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { isTTY: true, columns, rows: 24 });
  let captured = "";
  output.on("data", chunk => { captured += chunk.toString(); });
  const app = render(<TodoPanel todos={todos} />, {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    stderr: output as unknown as NodeJS.WriteStream,
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 40));
    // Ink emits cursor/colour control sequences; inspect only the displayed text.
    return captured.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  } finally {
    app.unmount(); input.destroy(); output.destroy();
  }
}

describe("TodoPanel", () => {
  it("bounds large lists and keeps active work visible", async () => {
    const todos: TodoItem[] = Array.from({ length: 30 }, (_, index) => ({ content: `Item ${index}`, status: index === 29 ? "in_progress" : "pending" }));
    const output = await display(todos);
    expect(output).toContain("Item 29");
    expect(output).toContain("+27 more · /todos");
    expect(output.trim().split("\n").length).toBeLessThanOrEqual(5);
  });
  it("hides an empty list", async () => {
    expect(await display([])).toBe("");
  });

  it("shows completed progress and differentiated rows, using activeForm only while running", async () => {
    const text = await display([
      { content: "Write code", activeForm: "Writing code", status: "completed" },
      { content: "Run tests", activeForm: "Running tests", status: "in_progress" },
      { content: "Ship changes", activeForm: "Shipping changes", status: "pending" },
    ]);
    expect(text).toContain("Todos 1/3 done");
    expect(text).toContain("✔ Write code");
    expect(text).toContain("▪ Running tests");
    expect(text).toContain("▫ Ship changes");
    expect(text).not.toContain("Writing code");
    expect(text).not.toContain("Shipping changes");
    expect(await display([{ content: "Finished", status: "completed" }])).toContain("Todos 1/1 done");
  });

  it("cleans untrusted labels and fits wide text within narrow columns", async () => {
    const text = await display([
      { content: "汉字汉字汉字汉字汉字\nNEXT\x1b[31mRED\x1b]0;malicious\x07", status: "in_progress", activeForm: "🔧汉字汉字汉字汉字汉字\nNEXT\x1b[31mRED\x1b]0;malicious\x07" },
    ], 18);
    expect(text).toContain("Todos 0/1 done");
    expect(text).toContain("▪ 🔧汉字");
    expect(text).toContain("…");
    expect(text).not.toContain("NEXT");
    expect(text).not.toContain("malicious");
    expect(text).not.toContain("[31m");
    for (const row of text.split("\n")) {
      expect(Bun.stringWidth(row)).toBeLessThanOrEqual(18);
    }
  });
});
