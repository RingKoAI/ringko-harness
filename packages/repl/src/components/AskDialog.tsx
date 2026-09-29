import { Box, Text, useInput, usePaste, useStdout } from "ink";
import { useState } from "react";
import wrapAnsi from "wrap-ansi";
import { ASK_LIMITS, type AskInput, type AskAnswer, type AskOutput } from "@ringko-ai/tools";
import { cleanTerminalText, fitTerminalLine, graphemes } from "../editor.ts";
import { theme } from "../theme.ts";

type Draft = { selected: string[]; custom: string };
const emptyDraft = (): Draft => ({ selected: [], custom: "" });

export function AskDialog({ input, onAnswer, onCancel }: { input: AskInput; onAnswer: (output: AskOutput) => void; onCancel: () => void }) {
  const { stdout } = useStdout();
  const width = Math.max(1, (stdout.columns ?? 80) - 4);
  const optionCount = Math.max(1, Math.min(6, (stdout.rows ?? 24) - 12));
  // The index after the last question is the review screen; only that screen submits.
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(!input.questions[0]?.options?.length);
  const [drafts, setDrafts] = useState<Draft[]>(() => input.questions.map(emptyDraft));
  const [feedback, setFeedback] = useState("");
  const [done, setDone] = useState(false);
  const [detailOffset, setDetailOffset] = useState(0);
  const question = input.questions[index];
  const options = question?.options ?? [];
  const draft = drafts[index];
  const reviewing = index === input.questions.length;
  const optionStart = Math.max(0, Math.min(cursor - Math.floor(optionCount / 2), options.length - optionCount));
  const detailCount = 2;
  const focused = options[cursor];
  const detailLines = wrapAnsi(cleanTerminalText(reviewing ? input.questions.map((item, position) => `${position + 1}. ${item.header || item.question}: ${drafts[position].selected.join(", ")}${drafts[position].custom ? ` · ${drafts[position].custom}` : ""}`).join("\n") : [question.question, question.detail, focused ? `${focused.label}${focused.description ? ` — ${focused.description}` : ""}` : undefined].filter(Boolean).join("\n")), width, { hard: true, trim: false }).split("\n");
  const visibleCount = reviewing ? Math.max(1, Math.min(8, (stdout.rows ?? 24) - 8)) : detailCount;
  const detailStart = Math.min(detailOffset, Math.max(0, detailLines.length - visibleCount));

  const updateDraft = (change: (previous: Draft) => Draft) => {
    setDrafts(previous => previous.map((item, position) => position === index ? change(item) : item));
    setFeedback("");
  };
  const append = (text: string) => {
    updateDraft(previous => ({ ...previous, custom: (previous.custom + cleanTerminalText(text)).slice(0, ASK_LIMITS.answerCharacters) }));
  };
  const visit = (next: number) => {
    setIndex(next);
    setDetailOffset(0);
    setFeedback("");
    if (next < input.questions.length) {
      const target = input.questions[next];
      const saved = drafts[next];
      setCursor(Math.max(0, target.options?.findIndex(option => option.label === saved.selected[0]) ?? 0));
      setEditing(!target.options?.length);
    } else setEditing(false);
  };
  const advance = () => {
    if (!draft.selected.length && !draft.custom.trim()) {
      setFeedback("Choose an option or enter a custom answer before continuing.");
      return;
    }
    visit(index + 1);
  };

  usePaste(text => { if (!reviewing && !done) { setEditing(true); append(text); } });
  useInput((text, key) => {
    if (done) return;
    if (key.pageUp) { setDetailOffset(Math.max(0, detailStart - visibleCount)); return; }
    if (key.pageDown) { setDetailOffset(Math.min(Math.max(0, detailLines.length - visibleCount), detailStart + visibleCount)); return; }
    if (key.escape || (key.ctrl && text === "c")) { setDone(true); onCancel(); return; }
    if (reviewing) {
      if (key.leftArrow || key.backspace) visit(index - 1);
      else if (key.return) {
        setDone(true);
        const answers: AskAnswer[] = input.questions.map((item, position) => ({
          id: item.id,
          selected: drafts[position].selected,
          ...(drafts[position].custom.trim() ? { custom: drafts[position].custom.trim() } : {}),
        }));
        onAnswer({ answers });
      }
      return;
    }
    if (key.tab) { setEditing(previous => !previous); setFeedback(""); return; }
    if (editing) {
      if (key.return) { advance(); return; }
      if (key.backspace || key.delete) updateDraft(previous => ({ ...previous, custom: graphemes(previous.custom).slice(0, -1).join("") }));
      else if (!key.ctrl && !key.meta && text) append(text);
      return;
    }
    if (key.leftArrow && index > 0) { visit(index - 1); return; }
    if (key.upArrow) { setCursor(previous => Math.max(0, previous - 1)); return; }
    if (key.downArrow) { setCursor(previous => Math.min(options.length, previous + 1)); return; }
    if (cursor === options.length) {
      if (key.return || text === " ") { setEditing(true); setFeedback(""); }
      return;
    }
    if (text === " " || (key.return && !question.multiSelect && draft.selected[0] !== options[cursor]?.label)) {
      const label = options[cursor]?.label;
      if (label !== undefined) updateDraft(previous => ({ ...previous, selected: question.multiSelect
        ? previous.selected.includes(label) ? previous.selected.filter(value => value !== label) : [...previous.selected, label]
        : [label] }));
      return;
    }
    if (key.return) advance();
  });

  if (reviewing) return <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
    <Text bold color={theme.brand}>Review answers</Text>
    {detailLines.slice(detailStart, detailStart + visibleCount).map((line, row) => <Text key={row}>{line}</Text>)}
    <Text color={theme.dim}>{fitTerminalLine("Enter submit · Left edit · PgUp/PgDn details · Esc cancel", width)}</Text>
  </Box>;

  return <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
    <Text bold color={theme.brand}>{fitTerminalLine(`Question ${index + 1}/${input.questions.length}${question.header ? ` · ${question.header}` : ""}`, width)}</Text>
    {detailLines.slice(detailStart, detailStart + visibleCount).map((line, row) => <Text key={row}>{line}</Text>)}
    {options.slice(optionStart, optionStart + optionCount).map((option, row) => { const optionIndex = optionStart + row; return <Text key={option.label} color={!editing && optionIndex === cursor ? theme.brand : undefined}>{fitTerminalLine(`${optionIndex === cursor && !editing ? ">" : " "} ${draft.selected.includes(option.label) ? "[x]" : "[ ]"} ${option.label}${option.description ? ` — ${option.description}` : ""}`, width)}</Text>; })}
    <Text color={editing || cursor === options.length ? theme.brand : theme.dim}>{fitTerminalLine(`${!editing && cursor === options.length ? ">" : " "} Custom: ${draft.custom || (editing ? "Type your answer" : "Enter/Tab to type")}`, width)}</Text>
    {feedback ? <Text color={theme.brand}>{fitTerminalLine(feedback, width)}</Text> : null}
    <Text color={theme.dim}>{fitTerminalLine("Up/Down · Space select · Enter next · Tab custom · PgUp/PgDn details · Esc", width)}</Text>
  </Box>;
}
