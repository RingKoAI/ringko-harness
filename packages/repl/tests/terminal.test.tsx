import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { render, useInput } from "ink";
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
import { cleanTerminalText } from "../src/editor.ts";
import { PermissionManager } from "../../sdk/src/permissions.ts";

function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { columns: 80, rows: 24, isTTY: true });
  let rendered = "";
  output.on("data", chunk => { rendered += chunk.toString(); });
  return { input, output, read: () => rendered };
}
// Ink batches frames; wait beyond its default 32ms render interval.
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe("terminal component interactions", () => {
  it("shows and confirms removal of a saved rule from the permissions picker", async () => {
    const io = terminal();
    const root = mkdtempSync(join(tmpdir(), "rkh-permission-picker-"));
    const previousHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
    const manager = new PermissionManager(root);
    const rule = { tool: "shell", target: "echo fixture", behavior: "allow" as const };
    manager.add("", rule, "saved");
    const model: ModelClient = async () => ({ content: "", toolCalls: [] });
    const app = render(<Repl workspace={root} model={model} modelLabel="test" config={{}} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write("/permissions"); await settle(); io.input.write("\r"); await settle();
      expect(io.read()).toContain("Permission rules");
      expect(io.read()).toContain("echo fixture");
      io.input.write("\r"); await settle();
      expect(manager.list("", "saved")).toEqual([rule]);
      expect(io.read()).toContain("Remove this rule");
      io.input.write("\r"); await settle();
      expect(manager.list("", "saved")).toEqual([]);
    } finally {
      app.unmount(); io.input.destroy(); io.output.destroy();
      if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("places the empty-session welcome near the header without keyboard input", async () => {
    const io = terminal();
    Object.assign(io.output, { rows: 50 });
    const root = mkdtempSync(join(tmpdir(), "rkh-welcome-"));
    const previousHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
    const model: ModelClient = async () => ({ content: "", toolCalls: [] });
    const app = render(<Repl workspace={root} model={model} modelLabel="test" config={{}} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle();
      const rows = cleanTerminalText(io.read()).split("\n");
      const header = rows.findIndex(row => row.includes("RingKo · test"));
      const welcome = rows.findIndex(row => row.includes("What would you like to work on?"));
      expect(header).toBeGreaterThanOrEqual(0);
      expect(welcome).toBeGreaterThan(header);
      expect(welcome - header).toBeLessThanOrEqual(3);
      expect(rows.some(row => row.includes("Message, /command or !shell command"))).toBe(true);
    } finally {
      app.unmount(); io.input.destroy(); io.output.destroy();
      if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("renders assistant Markdown through the Ink transcript", async () => {
    const io = terminal();
    const app = render(<Transcript items={[{ id: 1, kind: "assistant", text: "# Heading\n\n**Answer**\n\n```ts\nconst value = 1;\n```" }]} columns={80} rows={20} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream });
    try {
      await settle();
      expect(io.read()).toContain("Heading");
      expect(io.read()).toContain("Answer");
      expect(io.read()).toContain("const value = 1;");
      expect(io.read()).not.toContain("**Answer**");
      expect(io.read()).not.toContain("```ts");
    } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
  it("executes bang input locally without calling the model", async () => {
    const io = terminal(); let modelCalls = 0;
    const root = mkdtempSync(join(tmpdir(), "rkh-bang-"));
    const previousHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
    const model: ModelClient = async () => { modelCalls++; return { content: "unexpected", toolCalls: [] }; };
    const app = render(<Repl workspace={root} model={model} modelLabel="test" config={{ expandTools: true }} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write("!echo rkh-local-ok"); await settle(); io.input.write("\r");
      await settle(); await settle(); await settle();
      expect(modelCalls).toBe(0);
      expect(io.read()).toContain("Exit 0");
      expect(io.read()).toContain("  rkh-local-ok");
    } finally {
      app.unmount(); io.input.destroy(); io.output.destroy();
      if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("keeps tool output in an indented block and toggles it with Ctrl+O", async () => {
    const io = terminal();
    const items = [{ id: 1, kind: "assistant" as const, text: "Checking the file" }, { id: 2, kind: "tool" as const, text: "RAW TOOL PAYLOAD", toolName: "read", arguments: { path: "main.ts" } }];
    function Harness() {
      const [expanded, setExpanded] = useState(false);
      useInput((input, key) => { if (key.ctrl && input === "o") setExpanded(value => !value); });
      return <Transcript items={items} expandTools={expanded} columns={80} rows={20} />;
    }
    const app = render(<Harness />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle();
      expect(io.read()).toContain("read (main.ts)");
      expect(io.read()).not.toContain("RAW TOOL PAYLOAD");
      io.input.write("\x0f"); await settle(); await settle();
      expect(io.read()).toContain("  RAW TOOL PAYLOAD");
      expect(io.read()).toContain("Ctrl+O collapse");
    } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
  it("answers multi-select questions and custom followups through the keyboard", async () => {
    const io = terminal(); let output: AskOutput | undefined;
    const app = render(<AskDialog input={{ questions: [{ id: "scope", question: "Choose scope", multiSelect: true, options: [{ label: "Auth" }, { label: "Logs" }] }, { id: "detail", question: "Extra details?" }] }} onAnswer={value => { output = value; }} onCancel={() => { throw new Error("Unexpected cancellation"); }} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write(" "); await settle(); io.input.write("\x1b[B"); await settle(); io.input.write(" "); await settle(); io.input.write("\r"); await settle();
      io.input.write("Review failures"); await settle(); io.input.write("\r"); await settle();
      expect(output).toBeUndefined();
      io.input.write("\r"); await settle();
      expect(output).toEqual({ answers: [{ id: "scope", selected: ["Auth", "Logs"] }, { id: "detail", selected: [], custom: "Review failures" }] });
    } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
  it("keeps focus distinct from selection, allows editing prior answers, and confirms before submitting", async () => {
    const io = terminal(); const submitted: AskOutput[] = [];
    const app = render(<AskDialog input={{ questions: [
      { id: "mode", question: "Mode?", options: [{ label: "Fast" }, { label: "Safe" }] },
      { id: "notes", question: "Notes?" },
    ] }} onAnswer={value => submitted.push(value)} onCancel={() => { throw new Error("Unexpected cancellation"); }} />,
      { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    const send = async (value: string) => { io.input.write(value); await settle(); };
    try {
      await settle();
      await send("\x1b[B"); // focus Safe; this must not select or advance
      expect(io.read()).toContain("> [ ] Safe");
      await send("\r"); expect(submitted).toEqual([]);
      expect(io.read()).toContain("[x] Safe");
      await send("\r"); expect(io.read()).toContain("Notes?");
      await send("first"); await send("\x1b[D"); // editing consumes arrow; no navigation
      await send("\r"); expect(io.read()).toContain("Review answers");
      expect(submitted).toEqual([]);
      await send("\x1b[D"); await send("\x7f"); await send("second"); await send("\r");
      await send("\x1b[D"); await send("\t"); await send("\x1b[D");
      expect(io.read()).toContain("[x] Safe");
      await send(" "); // change selection without accidentally submitting
      expect(io.read()).toContain("[ ] Safe");
      await send("\x1b[A"); await send(" "); await send("\r");
      await send("\r"); expect(submitted).toEqual([]);
      await send("\r");
      expect(submitted).toEqual([{ answers: [{ id: "mode", selected: ["Fast"] }, { id: "notes", selected: [], custom: "firssecond" }] }]);
    } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
  });
  it("exposes custom answer in the option list and handles invalid answers and cancellation", async () => {
    const io = terminal(); let cancelled = 0; const submitted: AskOutput[] = [];
    const app = render(<AskDialog input={{ questions: [{ id: "choice", question: "Choose", options: [{ label: "Default" }] }] }} onAnswer={value => submitted.push(value)} onCancel={() => { cancelled++; }} />,
      { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    const send = async (value: string) => { io.input.write(value); await settle(); };
    try {
      await settle(); await send("\x1b[B");
      expect(io.read()).toContain("> Custom:");
      await send("\r"); await send("\r");
      expect(io.read()).toContain("Choose an option or enter a custom answer");
      expect(submitted).toEqual([]);
      await send("Alternative"); await send("\r");
      expect(submitted).toEqual([]);
      await send("\x1b"); expect(cancelled).toBe(1);
      expect(submitted).toEqual([]);
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
      await settle(); expect(io.read()).toContain("What would you like to work on?");
      const beforeFirstPrompt = io.read().length;
      await settle(); io.input.write("first"); await settle(); io.input.write("\r"); await settle();
      expect(captured).toHaveLength(1);
      expect(io.read().slice(beforeFirstPrompt).split("\u001b[?2026h").at(-1)).not.toContain("What would you like to work on?");
      io.input.write("\x10"); await settle();
      io.input.write("second"); await settle(); io.input.write("\r"); await settle();
      expect(captured[1].some(message => message.content === "first")).toBe(true);
      const beforeNewSession = io.read().length;
      io.input.write("/new"); await settle(); io.input.write("\r"); await settle();
      expect(io.read().slice(beforeNewSession)).toContain("What would you like to work on?");
      io.input.write("third"); await settle(); io.input.write("\r"); await settle();
      expect(captured[2].map(message => message.content)).toEqual(["third"]);
    } finally {
      app.unmount(); io.input.destroy(); io.output.destroy();
      if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("switches between main and a delegated task tree without mixing transcripts", async () => {
    const root = mkdtempSync(join(tmpdir(), "rkh-subagent-view-"));
    const oldHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
    const io = terminal();
    const model: ModelClient = async request => {
      const last = request.messages.at(-1);
      if (request.messages.some(message => message.role === "user" && message.content === "Inspect files")) return { content: "child findings", toolCalls: [] };
      if (last?.role === "tool") return { content: "main result", toolCalls: [] };
      return { content: "", toolCalls: [{ id: "delegation", name: "task", arguments: { description: "Inspect files", prompt: "Inspect files", mode: "read" } }] };
    };
    const app = render(<Repl workspace={root} model={model} modelLabel="test" config={{}} />, { stdin: io.input as unknown as NodeJS.ReadStream, stdout: io.output as unknown as NodeJS.WriteStream, stderr: io.output as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
    try {
      await settle(); io.input.write("delegate"); await settle(); io.input.write("\r");
      await settle(); await settle(); await settle();
      expect(io.read()).toContain("Main · 1 subagent");
      const beforePicker = io.read().length;
      io.input.write("\x07"); await settle();
      expect(io.read().slice(beforePicker)).toContain("Main / Subagent views");
      io.input.write("\x1b[B"); await settle(); io.input.write("\r"); await settle();
      const subFrame = io.read().split("\u001b[?2026h").at(-1) ?? "";
      expect(subFrame).toContain("child findings");
      expect(subFrame).not.toContain("main result");
      io.input.write("\x07"); await settle(); io.input.write("\x1b[A"); await settle(); io.input.write("\r"); await settle();
      const mainFrame = io.read().split("\u001b[?2026h").at(-1) ?? "";
      expect(mainFrame).toContain("main result");
      expect(mainFrame).not.toContain("child findings");
    } finally {
      app.unmount(); io.input.destroy(); io.output.destroy();
      if (oldHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = oldHome;
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
