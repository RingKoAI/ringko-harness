import { Box, Text, useInput, usePaste } from "ink";
import { useState } from "react";
import { ASK_LIMITS, type AskInput, type AskAnswer, type AskOutput } from "@ringko-ai/tools";
import { cleanTerminalText, graphemes } from "../editor.ts";
import { theme } from "../theme.ts";

export function AskDialog({ input, onAnswer, onCancel }: { input: AskInput; onAnswer: (output: AskOutput) => void; onCancel: () => void }) {
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [editing, setEditing] = useState(!input.questions[0]?.options?.length);
  const [answers, setAnswers] = useState<AskAnswer[]>([]);
  const question = input.questions[index];
  const options = question.options ?? [];
  const append = (text: string) => setCustom(previous => (previous + cleanTerminalText(text)).slice(0, ASK_LIMITS.answerCharacters));
  usePaste(text => { setEditing(true); append(text); });
  useInput((text, key) => {
    if (key.escape || (key.ctrl && text === "c")) { onCancel(); return; }
    if (key.tab) { setEditing(previous => !previous); return; }
    if (key.return) {
      const chosen = !editing && !question.multiSelect && options[cursor] ? [options[cursor].label] : selected;
      if (!chosen.length && !custom.trim()) return;
      const next = [...answers, { id: question.id, selected: chosen, ...(custom.trim() ? { custom: custom.trim() } : {}) }];
      if (index + 1 === input.questions.length) onAnswer({ answers: next });
      else { setAnswers(next); setIndex(index + 1); setCursor(0); setSelected([]); setCustom(""); setEditing(!input.questions[index + 1].options?.length); }
      return;
    }
    if (editing) {
      if (key.backspace || key.delete) setCustom(previous => graphemes(previous).slice(0, -1).join(""));
      else if (!key.ctrl && !key.meta && text) append(text);
    } else {
      if (key.upArrow) setCursor(previous => Math.max(0, previous - 1));
      if (key.downArrow) setCursor(previous => Math.min(options.length - 1, previous + 1));
      if (text === " " && question.multiSelect && options[cursor]) setSelected(previous => previous.includes(options[cursor].label) ? previous.filter(label => label !== options[cursor].label) : [...previous, options[cursor].label]);
    }
  });
  return <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
    <Text bold color={theme.brand}>Question {index + 1}/{input.questions.length}{question.header ? ` · ${cleanTerminalText(question.header)}` : ""}</Text>
    <Text>{cleanTerminalText(question.question)}</Text>
    {question.detail ? <Text color={theme.dim}>{cleanTerminalText(question.detail)}</Text> : null}
    {options.map((option, optionIndex) => <Text key={option.label} color={!editing && optionIndex === cursor ? theme.brand : undefined}>{optionIndex === cursor && !editing ? ">" : " "} {selected.includes(option.label) ? "[x]" : "[ ]"} {cleanTerminalText(option.label)}{option.description ? ` — ${cleanTerminalText(option.description)}` : ""}</Text>)}
    <Text color={editing ? theme.brand : theme.dim}>Custom: {custom || (editing ? "Type your answer" : "Tab to type")}</Text>
    <Text color={theme.dim}>Up/Down choose · Space multi-select · Tab custom · Enter next/submit · Esc cancel</Text>
  </Box>;
}
