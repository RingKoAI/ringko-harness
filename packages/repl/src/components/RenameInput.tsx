import { Text, useInput, usePaste, useStdout } from "ink";
import { useState } from "react";
import { edit, editorLines, fitTerminalLine, graphemes, type EditorState } from "../editor.ts";
import { theme } from "../theme.ts";
import { Panel } from "./Panel.tsx";
import { terminalColumns } from "../terminal-layout.ts";

export interface RenameInputProps {
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** A single-line editor for renaming a session. Enter saves, Esc cancels. */
export function RenameInput({ initial, onSubmit, onCancel }: RenameInputProps) {
  const { stdout } = useStdout();
  const width = Math.max(1, terminalColumns(stdout.columns ?? 80) - 4);
  const [editor, setEditor] = useState<EditorState>({ text: initial, cursor: graphemes(initial).length });
  usePaste(text => setEditor(previous => edit(previous, { type: "insert", text: text.replace(/[\r\n]+/g, " ") })));
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) { onCancel(); return; }
    if (key.return) {
      const value = editor.text.trim();
      if (value) onSubmit(value); else onCancel();
      return;
    }
    if (key.backspace || key.delete) { setEditor(edit(editor, { type: "backspace" })); return; }
    if (key.leftArrow) { setEditor(edit(editor, { type: "left" })); return; }
    if (key.rightArrow) { setEditor(edit(editor, { type: "right" })); return; }
    if (key.home) { setEditor(edit(editor, { type: "home" })); return; }
    if (key.end) { setEditor(edit(editor, { type: "end" })); return; }
    if (key.ctrl && input === "u") { setEditor(edit(editor, { type: "killStart" })); return; }
    if (key.ctrl && input === "w") { setEditor(edit(editor, { type: "killWord" })); return; }
    if (!key.ctrl && !key.meta && input) setEditor(edit(editor, { type: "insert", text: input }));
  });
  const lines = editorLines(editor, width, 1);
  return (
    <Panel title="Rename session">
      {lines.map((line, index) => (
        <Text key={index}>
          <Text color={theme.brand}>{"> "}</Text>
          {line.before}{line.cursor !== undefined ? <Text inverse>{line.cursor}</Text> : null}{line.after}
        </Text>
      ))}
      <Text color={theme.dim}>{fitTerminalLine("Enter save · Esc cancel", width)}</Text>
    </Panel>
  );
}
