import { Box, Text, useApp, useInput, usePaste, useStdout } from "ink";
import { Fragment, useState } from "react";
import { commandGroup, filterCommands } from "../commands.ts";
import { edit, editorLines, fitTerminalLine, graphemes, HISTORY_LIMIT, type EditorState } from "../editor.ts";
import { shortcut, type Shortcut } from "../keybindings.ts";
import { theme } from "../theme.ts";
import { truncate } from "../state.ts";

export interface PromptInputProps {
  running: boolean;
  editor: EditorState;
  onEdit: (state: EditorState) => void;
  history: readonly string[];
  onSubmit: (value: string) => void;
  onShortcut: (action: Shortcut) => void;
  onInterrupt: () => void;
  maxEditorLines?: number;
}
const MAX_SUGGESTIONS = 6;
const MAX_EDITOR_LINES = 5;

export function PromptInput({ running, editor, onEdit, history, onSubmit, onShortcut, onInterrupt, maxEditorLines = MAX_EDITOR_LINES }: PromptInputProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [selected, setSelected] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const value = editor.text;
  const maxSuggestions = Math.max(1, Math.min(MAX_SUGGESTIONS, Math.floor(((stdout.rows ?? 24) - 14) / 2)));
  const width = Math.max(10, (stdout.columns ?? 80) - 6);
  const suggestions = value.startsWith("/") && !/\s/.test(value) ? filterCommands(value.slice(1)).slice(0, maxSuggestions) : [];
  const active = Math.min(selected, Math.max(0, suggestions.length - 1));
  const recent = history.slice(-HISTORY_LIMIT);
  function change(action: Parameters<typeof edit>[1]) {
    onEdit(edit(editor, action));
    setSelected(0);
  }
  usePaste(text => { change({ type: "insert", text }); });
  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.ctrl && input === "c") {
      if (running) onInterrupt();
      else { change({ type: "clear" }); setHistoryIndex(null); }
      return;
    }
    if (key.ctrl && input === "d") {
      if (!running && !value) exit();
      else if (!running) change({ type: "delete" });
      return;
    }
    if (key.escape) { if (running) onInterrupt(); return; }
    const action = shortcut(input, key);
    if (action) { onShortcut(action); return; }
    if (key.return) {
      if (key.shift || key.meta) { change({ type: "insert", text: "\n" }); return; }
      if (running) return;
      let text = value.trim();
      if (!text) return;
      if (suggestions[active]) text = `/${suggestions[active].name}`;
      change({ type: "clear" }); setHistoryIndex(null); onSubmit(text); return;
    }
    if (key.tab) { const chosen = suggestions[active]; if (chosen) change({ type: "replace", text: `/${chosen.name} ` }); return; }
    if (key.upArrow || key.downArrow) {
      if (suggestions.length) { setSelected(Math.max(0, Math.min(suggestions.length - 1, active + (key.upArrow ? -1 : 1)))); return; }
      const chars = graphemes(value);
      if ((key.upArrow && chars.slice(0, editor.cursor).includes("\n")) || (key.downArrow && chars.slice(editor.cursor).includes("\n"))) {
        change({ type: key.upArrow ? "up" : "down" }); return;
      }
      if (!recent.length) return;
      if (historyIndex === null && key.downArrow) return;
      if (historyIndex === null) setDraft(value);
      const index = Math.max(0, Math.min(recent.length, (historyIndex ?? recent.length) + (key.upArrow ? -1 : 1)));
      setHistoryIndex(index === recent.length ? null : index);
      change({ type: "replace", text: recent[index] ?? draft }); return;
    }
    if (key.ctrl) {
      const type = ({ a: "home", e: "end", u: "killStart", k: "killEnd", w: "killWord", b: "left", f: "right" } as const)[input as "a" | "e" | "u" | "k" | "w" | "b" | "f"];
      if (type) change({ type });
      return;
    }
    if (key.leftArrow) change({ type: "left" });
    else if (key.rightArrow) change({ type: "right" });
    else if (key.home) change({ type: "home" });
    else if (key.end) change({ type: "end" });
    else if (key.backspace) change({ type: "backspace" });
    else if (key.delete) change({ type: "delete" });
    else if (!key.meta && input) change({ type: "insert", text: input });
  });

  const lines = editorLines(editor, Math.max(1, (stdout.columns ?? 80) - 4), Math.max(1, maxEditorLines));
  return <Box flexDirection="column" flexShrink={0}>
    {suggestions.length ? <Box flexDirection="column" paddingX={1}>
      {suggestions.map((command, index) => <Fragment key={command.name}>
        {index === 0 || commandGroup(suggestions[index - 1]?.name ?? "") !== commandGroup(command.name) ? <Text color={theme.dim} bold>{commandGroup(command.name)}</Text> : null}
        <Box>
        <Text color={index === active ? theme.brand : undefined} bold={index === active}>/{command.name}</Text>
        <Text color={theme.dim}>  {truncate(command.description, Math.max(1, width - command.name.length - 3))}</Text>
      </Box></Fragment>)}
      <Text color={theme.dim}>{truncate("Up/Down select · Tab complete · Enter run", width)}</Text>
    </Box> : null}
    <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor={running ? theme.permission : theme.brand} paddingX={1}>
      <Text color={theme.brand}>{"> "}</Text>
      <Box flexGrow={1} flexDirection="column">
        {!value ? <Text><Text inverse> </Text><Text color={theme.dim}>{fitTerminalLine(running ? "Working · Esc interrupts" : "Message, /command or !shell command", Math.max(1, (stdout.columns ?? 80) - 5))}</Text></Text> : lines.map((line, index) => <Text key={index}>{line.before}{line.cursor !== undefined ? <Text inverse>{line.cursor}</Text> : null}{line.after}</Text>)}
      </Box>
    </Box>
    <Text color={theme.dim}>{truncate(`${running ? "Esc interrupt" : "Enter send"} · Alt+Enter newline · Up/Down history · Ctrl+L models`, width)}</Text>
  </Box>;
}
