import { Text, useInput, usePaste, useStdout } from "ink";
import { useEffect, useRef, useState } from "react";
import { parseProviderConnection, ProviderConnectionError, PROVIDER_CONNECT_LIMITS, type ProviderConnectionInput, type ProviderDefinition, type ProviderPreset } from "@ringko-ai/config";
import { cleanTerminalText, edit, editorLines, fitTerminalLine, graphemes, type EditorState } from "../editor.ts";
import { terminalColumns } from "../terminal-layout.ts";
import { hintLine } from "../chrome.ts";
import { theme } from "../theme.ts";
import { Panel } from "./Panel.tsx";

const FIELDS = ["name", "baseURL", "apiKey", "models"] as const;
const LABELS = { name: "Provider name", baseURL: "Base URL", apiKey: "API key (hidden)", models: "Model IDs (comma separated)" };
const LIMITS = { name: PROVIDER_CONNECT_LIMITS.name, baseURL: PROVIDER_CONNECT_LIMITS.url, apiKey: PROVIDER_CONNECT_LIMITS.key, models: 65_536 };
const SAVE_MS = 30_000;
const READ_MS = 10_000;
type Form = Record<typeof FIELDS[number], EditorState>;

/** API keys never enter transcript text or terminal output, including inactive fields. */
export function ProviderConnectDialog({ preset, initial, loadInitial, onSave, onClose }: {
  preset: ProviderPreset; initial?: ProviderDefinition;
  loadInitial?: (signal: AbortSignal) => Promise<ProviderDefinition | undefined>;
  onSave: (input: ProviderConnectionInput, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const { stdout } = useStdout(), width = Math.max(1, terminalColumns(stdout.columns ?? 80) - 2), compact = (stdout.rows ?? 24) < 22;
  const field = (text: string): EditorState => ({ text, cursor: graphemes(text).length });
  const [form, setForm] = useState<Form>({ name: field(initial?.name ?? preset.id), baseURL: field(initial?.baseURL ?? preset.baseURL ?? ""), apiKey: field(""), models: field("") });
  const firstField = preset.type === "openai-compatible" && !form.baseURL.text ? 1 : 2;
  const currentForm = useRef(form), position = useRef(firstField), advancedMode = useRef(false);
  const [advanced, setAdvanced] = useState(false), [selected, setSelected] = useState(firstField), [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  const reading = useRef<AbortController | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">(loadInitial ? "loading" : "ready"), readStatus = useRef(readState);
  const [revision, setRevision] = useState(0);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!loadInitial) return;
    const controller = new AbortController(); reading.current = controller; readStatus.current = "loading"; setReadState("loading");
    const fail = () => { readStatus.current = "error"; setReadState("error"); setMessage("Cannot load provider settings. Press R to retry or Esc to return."); };
    const timer = setTimeout(() => { controller.abort(); fail(); }, READ_MS);
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return loadInitial(controller.signal); }).then(provider => {
      if (controller.signal.aborted) return;
      const next = { name: field(provider?.name ?? preset.id), baseURL: field(provider?.baseURL ?? preset.baseURL ?? ""), apiKey: field(""), models: field("") };
      currentForm.current = next; setForm(next); select(preset.type === "openai-compatible" && !next.baseURL.text ? 1 : 2);
      readStatus.current = "ready"; setReadState("ready"); setMessage("");
    }).catch(() => { if (!controller.signal.aborted) fail(); }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); if (reading.current === controller) reading.current = null; };
  }, [loadInitial, revision]);
  function select(index: number): void { position.current = (index + FIELDS.length) % FIELDS.length; setSelected(position.current); }
  function change(action: Parameters<typeof edit>[1]): void {
    if (pending.current || readStatus.current !== "ready") return;
    const key = FIELDS[position.current]!, value = edit(currentForm.current[key], action);
    if (value.text.length > LIMITS[key]) { setMessage(`${LABELS[key]} exceeds its length limit.`); return; }
    const next = { ...currentForm.current, [key]: value }; currentForm.current = next; setForm(next); setMessage("");
  }
  function insert(text: string): void {
    if (readStatus.current !== "ready") return;
    const key = FIELDS[position.current]!;
    if (text.length > LIMITS[key]) { setMessage(`${LABELS[key]} exceeds its length limit.`); return; }
    change({ type: "insert", text: cleanTerminalText(text).replace(/[\r\n]+/g, " ") });
  }
  function save(): void {
    if (pending.current || readStatus.current !== "ready") return;
    const values = currentForm.current;
    let input: ProviderConnectionInput;
    try { input = parseProviderConnection({ name: values.name.text, type: preset.type, baseURL: values.baseURL.text.trim(), apiKey: values.apiKey.text.trim(), modelIds: values.models.text.trim() ? values.models.text.split(",").map(id => id.trim()) : undefined }); }
    catch (error) { setMessage(error instanceof ProviderConnectionError ? error.message : "Check the provider fields."); return; }
    const controller = new AbortController(); pending.current = controller; setSaving(true); setMessage("Discovering models and saving…");
    const timer = setTimeout(() => { controller.abort(); if (pending.current === controller) { pending.current = null; setSaving(false); setMessage("Save not confirmed. Reopen /connect to verify before retrying."); } }, SAVE_MS);
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return onSave(input, controller.signal); }).catch(error => {
      if (!controller.signal.aborted) setMessage(error instanceof ProviderConnectionError ? error.message : "Could not connect. Check the fields or enter model IDs and retry.");
    }).finally(() => { clearTimeout(timer); if (pending.current === controller) { pending.current = null; setSaving(false); } });
  }
  usePaste(insert);
  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || key.ctrl && input === "c") { reading.current?.abort(); pending.current?.abort(); onClose(); return; }
    if (readStatus.current !== "ready") { if (readStatus.current === "error" && input.toLowerCase() === "r" && !key.ctrl && !key.meta) setRevision(value => value + 1); return; }
    if (pending.current) return;
    if (key.ctrl && input === "s") { save(); return; }
    if (key.tab) {
      if (!advancedMode.current) { advancedMode.current = true; setAdvanced(true); select(key.shift ? position.current - 1 : 0); }
      else select(position.current + (key.shift ? -1 : 1));
      return;
    }
    if (key.return) {
      if (!advancedMode.current && position.current === 1) {
        try { parseProviderConnection({ name: currentForm.current.name.text, type: preset.type, baseURL: currentForm.current.baseURL.text.trim() }); select(2); }
        catch (error) { setMessage(error instanceof ProviderConnectionError ? error.message : "Check the base URL."); }
      } else if (!advancedMode.current || position.current === FIELDS.length - 1) save(); else select(position.current + 1);
      return;
    }
    if (key.upArrow || key.downArrow) { advancedMode.current = true; setAdvanced(true); select(position.current + (key.upArrow ? -1 : 1)); return; }
    const action = key.backspace ? "backspace" : key.delete ? "delete" : key.leftArrow ? "left" : key.rightArrow ? "right" : key.home ? "home" : key.end ? "end" : key.ctrl && input === "u" ? "killStart" : key.ctrl && input === "w" ? "killWord" : undefined;
    if (action) change({ type: action }); else if (!key.ctrl && !key.meta && input) insert(input);
  });
  if (readState !== "ready") return <Panel title={`Connect ${preset.label}`}>
    <Text color={readState === "error" ? theme.error : theme.secondaryText}>{fitTerminalLine(readState === "loading" ? "Loading provider settings…" : message, width)}</Text>
    <Text color={theme.secondaryText}>{hintLine(["Esc cancel", ...(readState === "error" ? ["R retry"] : [])], width)}</Text>
  </Panel>;
  const key = FIELDS[selected]!;
  const hint = !advanced && key === "apiKey" ? "Paste a key and press Enter to discover models. Empty keeps saved/env credentials."
    : key === "models" ? "Leave empty to discover models; enter IDs to skip discovery." : key === "apiKey" ? `Saved in auth.json; leave empty for saved credentials${preset.apiKeyEnv ? ` / ${preset.apiKeyEnv}` : ""}.` : key === "baseURL" ? "API root, not a chat/completions URL. Enter continues to the API key." : "Used in /model and the credential store.";
  return <Panel title={`Connect ${preset.label}`}>
    <Text color={theme.secondaryText}>{fitTerminalLine(`${preset.type} · ${advanced ? `${selected + 1}/${FIELDS.length}` : "Quick setup"}`, width)}</Text>
    {(compact ? [key] : FIELDS).map(name => {
      const value = form[name], active = name === key;
      const display = name === "apiKey" ? { text: "*".repeat(graphemes(value.text).length), cursor: value.cursor } : value;
      return <Text key={name}>{active ? <Text bold color={theme.brand}>{fitTerminalLine(LABELS[name], width)}</Text> : <Text color={theme.secondaryText}>{fitTerminalLine(`${LABELS[name]}: ${name === "apiKey" ? value.text ? "********" : "(saved / environment)" : value.text || "(automatic)"}`, width)}</Text>}{active ? "\n" : ""}{active ? <><Text color={theme.brand}>{"> "}</Text>{editorLines(display, Math.max(1, width - 2), 1).map((line, index) => <Text key={index}>{line.before}<Text inverse>{line.cursor ?? " "}</Text>{line.after}</Text>)}</> : null}</Text>;
    })}
    <Text color={theme.secondaryText}>{fitTerminalLine(hint, width)}</Text>
    {message ? <Text color={saving ? theme.secondaryText : theme.error}>{fitTerminalLine(message, width)}</Text> : null}
    <Text color={theme.secondaryText}>{hintLine(saving ? ["Esc cancel", "Saving connection"] : advanced ? ["Enter next/save", "Esc cancel", "Tab fields", "Ctrl+S save"] : [key === "baseURL" ? "Enter next" : "Enter connect", "Tab edit", "Esc cancel"], width)}</Text>
  </Panel>;
}
