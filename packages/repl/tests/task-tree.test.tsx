import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "./render.ts";
import { TaskTree } from "../src/components/TaskTree.tsx";
import type { SubagentView } from "../src/subagent-view.ts";

async function display(tasks: readonly SubagentView[], selectedId: string | undefined, columns = 80): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { isTTY: true, columns, rows: 24 });
  let captured = "";
  output.on("data", chunk => { captured += chunk.toString(); });
  const app = render(<TaskTree tasks={tasks} selectedId={selectedId} columns={columns} />, {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    stderr: output as unknown as NodeJS.WriteStream,
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 40));
    return captured.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  } finally {
    app.unmount(); input.destroy(); output.destroy();
  }
}

const base = (over: Partial<SubagentView> & Pick<SubagentView, "id" | "description" | "status">): SubagentView => ({
  mode: "read", model: "fixture", parentCallId: "call", startedAt: 0, toolCount: 0, items: [], ...over,
});

describe("TaskTree", () => {
  it("renders main plus a branded tree with running and finished tasks", async () => {
    const text = await display([
      base({ id: "a", description: "Inspect files", status: "running", startedAt: Date.now() - 5000, toolCount: 3 }),
      base({ id: "b", description: "Review code", status: "completed", startedAt: 0, endedAt: 2000 }),
    ], undefined);
    expect(text).toContain("main");
    expect(text).toContain("├─");
    expect(text).toContain("└─");
    expect(text).toContain("Inspect files");
    expect(text).toContain("Review code");
    expect(text).toContain("▶");
    expect(text).toContain("⏸");
    expect(text).toContain("3 tools");
    expect(text).toContain("2 subagents");
  });

  it("marks the viewed subagent and shows its tree pointer", async () => {
    const text = await display([
      base({ id: "a", description: "Inspect files", status: "running", startedAt: 0 }),
      base({ id: "b", description: "Review code", status: "failed", startedAt: 0, endedAt: 1000, reason: "execution_failed" }),
    ], "b");
    const rows = text.split("\n");
    expect(rows[0]).toContain("○ main");
    expect(text).toContain("> └─ ● Review code");
  });
});
