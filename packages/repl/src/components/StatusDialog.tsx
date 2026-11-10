import { Box, Text, useInput, usePaste } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_TABS, STATS_PERIODS, StatusUnavailableError, statusEntries, statusLines, validateRuntimeStatus, type StatusPageReport, type StatusSession, type StatusSetting, type StatusSettingKey, type StatusTab, type StatsPeriod } from "../status.ts";
import { cleanTerminalText, fitTerminalLine, graphemes } from "../editor.ts";
import { hintLine } from "../chrome.ts";
import { theme } from "../theme.ts";
import { STATS_VIEWS, statisticsLines, type StatsLine, type StatsView } from "../stats.ts";

type StatusState = { kind: "loading" } | { kind: "ready"; report: StatusPageReport } | { kind: "error"; message: string };
const STATUS_OPERATION_MS = 10_000;
const SEARCH_CHARACTERS = 128;
interface Navigation { tab: StatusTab; period: StatsPeriod; statsView: StatsView; offset: number; selected: number; searching: boolean; query: string }

export function StatusDialog({ load, session, columns, height, onClose, onMcp, onConfigChange, initialTab = "Status", command = "status" }: {
  load: (signal: AbortSignal, tab: StatusTab, period: StatsPeriod) => Promise<StatusPageReport>;
  session: StatusSession; columns: number; height: number;
  onClose: () => void; onMcp: () => void;
  onConfigChange?: (key: StatusSettingKey, value: boolean | string, signal: AbortSignal) => Promise<void>;
  initialTab?: StatusTab;
  command?: string;
}) {
  const [state, setState] = useState<StatusState>({ kind: "loading" });
  const [view, setView] = useState<Navigation>({ tab: initialTab, period: "all", statsView: "Overview", offset: 0, selected: 0, searching: false, query: "" });
  const navigation = useRef(view);
  const { tab, period, statsView, offset, selected, searching, query } = view;
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const write = useRef<AbortController | null>(null);
  const loaded = useRef<StatusPageReport | null>(null);
  const generation = useRef(0);
  const width = Math.max(1, columns - 2), spacious = height >= 16, splitHeader = width < 40;
  const statsNavigation = tab === "Stats" && height >= 10;
  const overhead = 4 + (spacious ? 2 : 0) + (splitHeader ? 1 : 0) + (statsNavigation ? spacious ? 2 : 1 : 0);
  const count = Math.max(1, height - overhead);
  // One stdin packet may contain several key events before React publishes a frame.
  function invalidate(): number { loaded.current = null; setState({ kind: "loading" }); return ++generation.current; }
  function move(patch: Partial<Navigation>): void {
    const next = { ...navigation.current, ...patch };
    if (next.tab !== navigation.current.tab || next.period !== navigation.current.period) { invalidate(); setRevision(value => value + 1); }
    navigation.current = next; setView(next);
  }
  useEffect(() => () => write.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const failure = `Cannot load ${tab.toLowerCase()}. Press R to retry.`;
    const current = invalidate();
    const timer = setTimeout(() => { controller.abort(); if (generation.current === current) setState({ kind: "error", message: failure }); }, STATUS_OPERATION_MS);
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(controller.signal, tab, period); }).then(validateRuntimeStatus).then(report => {
      if (!controller.signal.aborted && generation.current === current) { loaded.current = report; setState({ kind: "ready", report }); }
    }).catch(error => { if (!controller.signal.aborted && generation.current === current) setState({ kind: "error", message: error instanceof StatusUnavailableError ? error.message : failure }); }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, tab, period, revision]);
  const settings = state.kind === "ready" ? (state.report.settings ?? []).filter(setting => `${setting.label} ${setting.key}`.toLowerCase().includes(query.toLowerCase())) : [];
  const activeSetting = Math.max(0, Math.min(selected, Math.max(0, settings.length - 1)));
  const lines = useMemo(() => {
    if (state.kind !== "ready") return state.kind === "loading" ? [fitTerminalLine(`Loading ${tab.toLowerCase()}…`, width)] : statusLines([{ label: tab, value: state.message }], width);
    if (tab !== "Config") return statusLines(tab === "Status" ? statusEntries(state.report, session) : state.report.entries, width);
    const rows = (state.report.settings ?? []).filter(setting => `${setting.label} ${setting.key}`.toLowerCase().includes(query.toLowerCase()));
    const prefix = [...(searching || query ? [fitTerminalLine(`Search: ${query || "type to filter"}`, width)] : []), ...(notice ? statusLines([{ label: "Result", value: notice }], width) : [])].slice(0, Math.max(0, count - 1));
    const reason = rows[activeSetting]?.disabledReason;
    const reasonLines = reason ? statusLines([{ label: "Locked", value: reason }], width).slice(0, Math.max(0, count - prefix.length - 1)) : [];
    const visible = Math.max(1, count - prefix.length - reasonLines.length);
    const start = Math.max(0, activeSetting - visible + 1);
    return [
      ...prefix,
      ...rows.length ? rows.slice(start, start + visible).map((setting, index) => `${(start + index === activeSetting ? "> " : "  ").slice(0, width)}${fitTerminalLine(`${setting.label}: ${typeof setting.value === "boolean" ? setting.value ? "On" : "Off" : setting.value}${setting.disabledReason ? " (locked)" : ""}`, Math.max(0, width - 2))}`) : [fitTerminalLine(state.report.settings ? "No matching settings." : "This host does not expose editable settings.", width)],
      ...reasonLines,
      ...statusLines(state.report.entries, width),
    ];
  }, [state, session, width, tab, query, searching, activeSetting, count, notice]);
  const displayLines: StatsLine[] = useMemo(() => tab === "Stats" && state.kind === "ready" && state.report.statistics
    ? statisticsLines(state.report.statistics, period, statsView, width)
    : lines.map(text => ({ text })), [tab, state, period, statsView, width, lines]);
  const end = Math.max(0, displayLines.length - count), active = Math.min(offset, end);
  function change(setting: StatusSetting): void {
    if (write.current || !onConfigChange) return;
    if (setting.disabledReason) { setNotice(setting.disabledReason); return; }
    const value = typeof setting.value === "boolean" ? !setting.value : setting.options?.[(setting.options.indexOf(setting.value) + 1) % setting.options.length];
    if (value === undefined) return;
    const controller = new AbortController(); write.current = controller; setSaving(true); setNotice("Saving…");
    const timer = setTimeout(() => { controller.abort(); if (write.current === controller) { write.current = null; setSaving(false); setNotice("Save not confirmed; R refresh to verify."); } }, STATUS_OPERATION_MS);
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return onConfigChange(setting.key, value, controller.signal); }).then(() => {
      if (!controller.signal.aborted) { setNotice("Saved. Changes apply to subsequent runs."); invalidate(); setRevision(value => value + 1); }
    }).catch(error => { if (!controller.signal.aborted) setNotice(error instanceof StatusUnavailableError ? error.message : "Could not save setting; R refresh to verify."); }).finally(() => {
      clearTimeout(timer); if (write.current === controller) { write.current = null; setSaving(false); }
    });
  }
  function search(text: string): void {
    const current = navigation.current;
    if (current.tab === "Config" && current.searching && !write.current) move({ query: (current.query + cleanTerminalText(text).replace(/\s+/g, " ")).slice(0, SEARCH_CHARACTERS), selected: 0, offset: 0 });
  }
  usePaste(search);
  useInput((input, key) => {
    if (key.eventType === "release") return;
    const current = navigation.current;
    const rows = (loaded.current?.settings ?? []).filter(setting => `${setting.label} ${setting.key}`.toLowerCase().includes(current.query.toLowerCase()));
    const cursor = Math.max(0, Math.min(current.selected, Math.max(0, rows.length - 1)));
    const scroll = Math.min(current.offset, end);
    if (key.escape || (key.ctrl && input === "c")) {
      if (current.tab === "Config" && (current.searching || current.query)) { move({ searching: false, query: "", selected: 0, offset: 0 }); return; }
      write.current?.abort(); onClose(); return;
    }
    if (write.current) return;
    if (current.searching) {
      if (key.return || key.downArrow) { move({ searching: false }); return; }
      if (key.backspace || key.delete) { move({ query: graphemes(current.query).slice(0, -1).join(""), selected: 0, offset: 0 }); return; }
      if (!key.ctrl && !key.meta && !key.tab && input) { search(input); return; }
    }
    if (current.tab === "Stats" && (key.leftArrow || key.rightArrow || ["o", "m"].includes(input.toLowerCase()) && !key.ctrl && !key.meta)) {
      move({ statsView: input.toLowerCase() === "o" ? "Overview" : input.toLowerCase() === "m" ? "Models" : STATS_VIEWS[(STATS_VIEWS.indexOf(current.statsView) + 1) % STATS_VIEWS.length], offset: 0 }); return;
    }
    if (key.tab || key.leftArrow || key.rightArrow) {
      const direction = key.leftArrow || (key.tab && key.shift) ? -1 : 1;
      move({ tab: STATUS_TABS[(STATUS_TABS.indexOf(current.tab) + direction + STATUS_TABS.length) % STATUS_TABS.length], offset: 0, searching: false }); setNotice(""); return;
    }
    if (input.toLowerCase() === "r" && !key.ctrl && !key.meta) { move({ offset: 0 }); invalidate(); setRevision(value => value + 1); return; }
    if (current.tab === "Status" && input.toLowerCase() === "m" && !key.ctrl && !key.meta) { onMcp(); return; }
    if (current.tab === "Stats" && input.toLowerCase() === "t" && !key.ctrl && !key.meta) { move({ period: STATS_PERIODS[(STATS_PERIODS.indexOf(current.period) + 1) % STATS_PERIODS.length], offset: 0 }); return; }
    if (current.tab === "Config") {
      if (input === "/") { move({ searching: true, offset: 0 }); return; }
      if (key.pageUp) move({ offset: Math.max(0, scroll - count) }); else if (key.pageDown) move({ offset: Math.min(end, scroll + count) });
      else if (key.upArrow) move({ offset: 0, selected: Math.max(0, cursor - 1) });
      else if (key.downArrow) move({ offset: 0, selected: Math.max(0, Math.min(rows.length - 1, cursor + 1)) });
      else if (key.home) move({ offset: 0, selected: 0 }); else if (key.end) move({ offset: 0, selected: Math.max(0, rows.length - 1) });
      else if (key.return || input === " ") { if (scroll) { move({ offset: 0 }); return; } const setting = rows[cursor]; if (setting) change(setting); }
      return;
    }
    if (key.upArrow) move({ offset: Math.max(0, scroll - 1) }); else if (key.downArrow) move({ offset: Math.min(end, scroll + 1) });
    else if (key.pageUp) move({ offset: Math.max(0, scroll - count) }); else if (key.pageDown) move({ offset: Math.min(end, scroll + count) });
    else if (key.home) move({ offset: 0 }); else if (key.end) move({ offset: end });
  });
  const tabs = <>{STATUS_TABS.map(name => <Text key={name} bold={tab === name} color={tab === name ? theme.brand : theme.secondaryText} backgroundColor={tab === name ? theme.selected : undefined}> {name} </Text>)}</>;
  return <Box flexDirection="column" height={height} flexShrink={0}>
    <Text>{fitTerminalLine(`❯ /${command}`, columns)}</Text>
    {spacious ? <Text> </Text> : null}
    <Text color={theme.border}>{"─".repeat(Math.max(1, columns))}</Text>
    <Box flexDirection="column" paddingX={columns > 2 ? 1 : 0}>
      {splitHeader ? <><Text bold>Settings</Text><Text wrap="truncate-end">{tabs}</Text></> : <Text><Text bold>Settings  </Text>{tabs}</Text>}
      {spacious ? <Text> </Text> : null}
      {statsNavigation ? <><Text wrap="truncate-end">{STATS_VIEWS.map(name => <Text key={name} bold={statsView === name} underline={statsView === name} color={statsView === name ? theme.brand : theme.secondaryText}> {name} </Text>)}</Text>{spacious ? <Text> </Text> : null}</> : null}
      <Box flexDirection="column" height={count} overflowY="hidden">{displayLines.slice(active, active + count).map((line, index) => <Text key={index} bold={line.bold || tab === "Config" && line.text.startsWith("> ")} color={state.kind === "error" ? theme.error : line.tone === "chart" ? theme.brand : line.tone === "muted" ? theme.secondaryText : undefined}>{line.parts ? line.parts.map((part, index) => <Text key={index} bold={part.selected} underline={part.selected} color={part.selected || part.tone === "chart" ? theme.brand : theme.secondaryText}>{part.text}</Text>) : line.text || " "}</Text>)}</Box>
      <Text color={theme.secondaryText}>{saving ? fitTerminalLine("Saving setting… Esc back.", width) : hintLine(["Esc back", "Tab pages", ...(tab === "Config" ? ["Enter change", "↑/↓ select", "/ search", "R refresh", ...(end ? ["PgUp/PgDn details"] : [])] : [...(end ? ["↓ scroll"] : []), ...(tab === "Stats" ? ["←/→ views", "T range"] : []), "R refresh", ...(tab === "Status" ? ["M MCP"] : []), ...(end ? ["PgUp/PgDn", `${active + 1}-${Math.min(displayLines.length, active + count)}/${displayLines.length}`] : [])])], width)}</Text>
    </Box>
  </Box>;
}
