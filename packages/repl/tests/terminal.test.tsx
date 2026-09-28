import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { useEffect, useState } from "react";
import { PromptInput } from "../src/components/PromptInput.tsx";
import { Selector } from "../src/components/Selector.tsx";
import { Transcript } from "../src/components/Transcript.tsx";
import { Repl } from "../src/app.tsx";
import { AskDialog } from "../src/components/AskDialog.tsx";
import type { AskOutput } from "@ringko-ai/tools";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, ModelClient } from "@ringko-ai/sdk";
import type { EditorState } from "../src/editor.ts";

function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { columns: 80, rows: 24, isTTY: true });
  let rendered = "";
  output.on("data", chunk => { rendered += chunk.toString(); });
  return { input, output, read: () => rendered };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

describe("terminal component interactions", () => {
  it("answers multi-select questions and custom followups through the keyboard", async () => {
    const io = terminal(); let output: AskOutput | undefined;
    const app = render(<AskDialog input={{ questions: [{ id: "scope", question: "Choose scope", multiSelect: true, options: [{ label: "Auth" }, { label: "Logs" }] }, { id: "detail", question: "Extra details?" }] }} onAnswer={value => { output = value; }} onCancel={() => { throw new Error("Unexpected cancellation"); }} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write(" "); await settle(); io.input.write("\x1b[B"); await settle(); io.input.write(" "); await settle(); io.input.write("\r"); await settle();
      io.input.write("Review failures"); await settle(); io.input.write("\r"); await settle();
      expect(output).toEqual({ answers: [{ id: "scope", selected: ["Auth", "Logs"] }, { id: "detail", selected: [], custom: "Review failures" }] });
    } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
  it("retains model context after switching and starts a genuinely new session", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-tui-test-"));
    const previousHome = process.env.RINGKO_HOME;
    process.env.RINGKO_HOME = root;
    const io = terminal();
    const requests: readonly ChatMessage[][] = [];
    const captured = requests as ChatMessage[][];
    const model: ModelClient = async request => { captured.push([...request.messages]); return { content: "offline answer", toolCalls: [] }; };
    const app = render(<Repl workspace={root} model={model} modelLabel="Echo/alpha" config={{ model: "Echo/alpha", providers: [{ name: "Echo", type: "echo", models: [{ name: "alpha", id: "alpha" }, { name: "beta", id: "beta" }] }] }} createModel={async () => model} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write("first"); await settle(); io.input.write("\r"); await settle();
      expect(captured).toHaveLength(1);
      io.input.write("\x10"); await settle();
      io.input.write("second"); await settle(); io.input.write("\r"); await settle();
      expect(captured[1].some(message => message.content === "first")).toBe(true);
      io.input.write("/new"); await settle(); io.input.write("\r"); await settle();
      io.input.write("third"); await settle(); io.input.write("\r"); await settle();
      expect(captured[2].map(message => message.content)).toEqual(["third"]);
    } finally {
      app.unmount(); io.input.destroy(); io.output.destroy();
      if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("keeps shortcut letters out of the editor, restores drafts after history and accepts multiline input", async () => {
    const io = terminal();
    const actions: string[] = [];
    const submitted: string[] = [];
    let current: EditorState = { text: "draft", cursor: 5 };
    function Harness() {
      const [editor, setEditor] = useState(current);
      useEffect(() => { current = editor; }, [editor]);
      return <PromptInput editor={editor} onEdit={setEditor} running={false} history={["old prompt"]} onSubmit={value => submitted.push(value)} onShortcut={action => actions.push(action)} onInterrupt={() => actions.push("interrupt")} />;
    }
    const app = render(<Harness />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write("\x0c"); await settle();
      expect(actions).toEqual(["model"]); expect(current.text).toBe("draft");
      io.input.write("\x1b[A"); await settle(); expect(current.text).toBe("old prompt");
      io.input.write("\x1b[B"); await settle(); expect(current.text).toBe("draft");
      io.input.write("\x1b\r"); await settle(); expect(current.text).toBe("draft\n");
      io.input.write("next"); await settle(); io.input.write("\r"); await settle();
      expect(submitted).toEqual(["draft\nnext"]); expect(current.text).toBe("");
    } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
  it("does not select empty searches and cancels a grouped picker", async () => {
    const io = terminal(); const selected: string[] = []; let cancelled = false;
    const app = render(<Selector title="Models" items={[{ label: "Claude", value: "anthropic/claude", group: "Anthropic" }]} onSelect={value => selected.push(value)} onCancel={() => { cancelled = true; }} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write("nomatch"); await settle(); io.input.write("\r"); await settle();
      expect(selected).toEqual([]); expect(io.read()).toContain("No matches");
      io.input.write("\x1b"); await settle(); expect(cancelled).toBe(true);
    } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
  it("pages wrapped transcript rows instead of clipping a long answer", async () => {
    const io = terminal();
    const items = [{ id: 1, kind: "assistant" as const, text: Array.from({ length: 30 }, (_, n) => `line-${n}`).join("\n") }];
    const app = render(<Transcript items={items} columns={80} rows={5} offset={10} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream });
    try { await settle(); expect(io.read()).toContain("History"); expect(io.read()).toContain("line-19"); }
    finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
});
