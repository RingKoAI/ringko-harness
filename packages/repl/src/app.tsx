import { Box, Text, useApp, useInput, useStdout, useBoxMetrics, type DOMElement } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateSessionMeta, loopPrompt, parseLoopArgs, promiseText, type ChatMessage, type LoopOptions, type ModelClient, type RingKo, type ToolApprovalRequest } from "@ringko-ai/sdk";
import {
  AskManager,
  type AskEvent,
  type TodoItem,
} from "@ringko-ai/tools";
import { TodoPanel } from "./components/TodoPanel.tsx";
import { TaskTree } from "./components/TaskTree.tsx";
import {
  SessionStore,
  forkSession,
  recordSessionModel,
  recordSessionThinking,
  recordSessionTitle,
  sessionThinking,
  sessionTitle,
  sessionSummary,
  toChatMessages,
  sessionTodos,
  type SessionHandle,
} from "@ringko-ai/session";
import {
  modelLabel,
  configuredModelIds,
  PROVIDER_PRESETS,
  saveConfig,
  selectModel,
  resolveSelectionContext,
  setOAuthAccount,
  upsertProviderModels,
  writeDiagnostic,
  type RingkoConfig,
} from "@ringko-ai/config";
import { discoverModels } from "@ringko-ai/providers";
import { loginAnthropic, loginGitHubCopilot, loginOpenAiBrowser, loginOpenAiDevice, loginXaiDevice, openBrowser } from "@ringko-ai/auth";
import { Banner } from "./components/Banner.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { PromptInput } from "./components/PromptInput.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ApprovalDialog } from "./components/ApprovalDialog.tsx";
import { AskDialog } from "./components/AskDialog.tsx";
import { AuthDialog, type AuthBox } from "./components/AuthDialog.tsx";
import { RenameInput } from "./components/RenameInput.tsx";
import { Selector, type SelectorAction, type SelectorItem } from "./components/Selector.tsx";
import { findCommand, parseInput, type SlashContext } from "./commands.ts";
import { applyAgentEvent, finishPendingTools, nextId, noticeItem, userItem, type ReplItem } from "./state.ts";
import { modelItems, nextModel } from "./selection.ts";
import type { Shortcut } from "./keybindings.ts";
import { theme } from "./theme.ts";
import { HISTORY_LIMIT, type EditorState } from "./editor.ts";
import { copyToClipboard } from "./clipboard.ts";
import { messagesToItems } from "./state.ts";
import { runLocalShell } from "./local-shell.ts";
import { RuntimeManager } from "@ringko-ai/sdk/runtime";
import type { PermissionRule } from "@ringko-ai/sdk/runtime";
import { terminalColumns, terminalLayout } from "./terminal-layout.ts";
import { fitTerminalLine } from "./editor.ts";
import { applyTaskView, restoreTaskViews, type SubagentView } from "./subagent-view.ts";
import { BackendError, type BackendClient } from "@ringko-ai/client";
import { snapshotItems, snapshotTasks } from "./backend-state.ts";

export interface ReplProps {
  backend?: BackendClient;
  model: ModelClient;
  modelLabel: string;
  config: RingkoConfig;
  workspace: string;
  createModel?: (config: RingkoConfig) => Promise<ModelClient | string>;
  resumeSessionId?: string;
  modelId?: string;
  pickSession?: boolean;
  /** Optional cheaper model used to generate the session title. */
  smallModel?: ModelClient;
  /** Notified with the active session id (create, resume, switch). */
  onSession?: (id: string) => void;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
}

interface PickerState {
  title: string;
  items: SelectorItem[];
  onSelect: (value: string) => void;
  actions?: SelectorAction[];
}

function sessionItems(store: SessionStore, limit = 20): SelectorItem[] {
  return store
    .list()
    .slice(0, limit)
    .map((meta) => {
      const created = new Date(meta.header.createdAt).toLocaleString();
      let title = meta.id;
      let summary: string | undefined;
      try {
        const events = store.open(meta.id, "read").all();
        title = sessionTitle(events) ?? meta.id;
        summary = sessionSummary(events);
      } catch {
        // unreadable log: fall back to the id
      }
      return {
        label: title,
        description: summary ? `${summary} · ${created}` : `${created} · ${meta.id}`,
        group: meta.header.cwd ?? "Sessions",
        value: meta.id,
      };
    });
}

export function Repl(props: ReplProps) {
  const { exit } = useApp();
  const { createModel, workspace, onSession, backend } = props;

  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: terminalColumns(stdout.columns ?? 80), rows: stdout.rows ?? 24 });

  useEffect(() => {
    const update = () => setSize({ columns: terminalColumns(stdout.columns ?? 80), rows: stdout.rows ?? 24 });
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  // The model client is a function; keep it in a ref (useState would call it as
  // a lazy initializer).
  const modelRef = useRef<ModelClient>(props.model);
  const [modelVersion, setModelVersion] = useState(0);
  const [modelLabelText, setModelLabelText] = useState(props.modelLabel);
  const [config, setConfig] = useState<RingkoConfig>(props.config);
  const [items, setItems] = useState<ReplItem[]>([]);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [taskViews, setTaskViews] = useState<SubagentView[]>([]);
  const [viewedTaskId, setViewedTaskId] = useState<string>();
  const [running, setRunning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const busyRef = useRef(false);
  const [editor, setEditor] = useState<EditorState>({ text: "", cursor: 0 });
  const [history, setHistory] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [question, setQuestion] = useState<AskEvent | null>(null);
  const askRef = useRef<AskManager | null>(null);
  const [jobs, setJobs] = useState<Array<{ jobId: string; description: string; kind: string; status: string; background: boolean }>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [authBox, setAuthBox] = useState<AuthBox | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [loopStatus, setLoopStatus] = useState<string | undefined>(undefined);
  const loopRef = useRef<{ options: LoopOptions; iteration: number; active: boolean } | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [modelId, setModelId] = useState<string | undefined>(props.modelId);
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [thinking, setThinking] = useState<string>(props.config.thinking ?? "high");
  const [expandThinking, setExpandThinking] = useState<boolean>(props.config.expandThinking ?? false);
  const [expandTools, setExpandTools] = useState<boolean>(props.config.expandTools ?? false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const transcriptBox = useRef<DOMElement | null>(null);
  const transcriptSize = useBoxMetrics(transcriptBox);
  const ringkoRef = useRef<RingKo | null>(null);
  const runtimeRef = useRef<RuntimeManager | null>(null);
  const initializationRef = useRef<Promise<void> | null>(null);
  const sessionRef = useRef<SessionHandle | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const titledRef = useRef(false);
  const remoteSendingRef = useRef(false);
  const remoteToolsRef = useRef<string[] | undefined>(undefined);

  const print = useCallback((text: string) => setItems((previous) => [...previous, noticeItem(text)]), []);
  const reportRemote = useCallback((error: unknown) => {
    print(error instanceof Error ? error.message : String(error));
  }, [print]);

  useEffect(() => {
    if (!backend || !sessionId) return;
    let lastRevision = -1;
    let instance = "";
    let configRequest = false;
    const subscription = backend.watchSession(sessionId, snapshot => {
      if (snapshot.instance === instance && snapshot.revision < lastRevision) return;
      instance = snapshot.instance; lastRevision = snapshot.revision;
      historyRef.current = snapshot.messages;
      setItems(previous => [...snapshotItems(snapshot), ...previous.filter(item => item.kind === "notice").slice(-32)]);
      setSessionStarted(snapshot.messages.some(message => message.role !== "system") || snapshot.busy);
      setTaskViews(snapshotTasks(snapshot));
      setTodos(snapshot.todos); setJobs(snapshot.jobs); setTitle(snapshot.title ?? undefined);
      setHistory(snapshot.messages.filter(message => message.role === "user").map(message => message.content).slice(-HISTORY_LIMIT));
      busyRef.current = snapshot.busy || remoteSendingRef.current;
      setRunning(snapshot.busy || remoteSendingRef.current);
      setLoopStatus(snapshot.loop ? `loop ${snapshot.loop.iteration}${snapshot.loop.maxIterations ? `/${snapshot.loop.maxIterations}` : ""}` : undefined);
      const approval = snapshot.approvals[0];
      if (approval) {
        const current = { id: approval.id } as { id: string; scope?: "session" | "saved" };
        setPending({ request: {
          toolName: approval.toolName, riskLevel: approval.riskLevel, riskKind: approval.riskKind, reason: approval.reason,
          ...(approval.target ? { target: approval.target } : {}),
          remember: scope => { current.scope = scope; },
        }, resolve: approved => {
          void backend.request("/api/approval", { id: current.id, approved, scope: current.scope }).catch(reportRemote);
        } });
      } else setPending(null);
      const requested = snapshot.questions[0];
      setQuestion(requested ? { ...requested, type: "requested" } : null);
    }, error => {
      if (error instanceof BackendError && error.status === 404) { print("Session was deleted in another client."); setSessionId(undefined); }
      else reportRemote(error);
    }, notice => {
      if (notice.kind === "session" || notice.kind === "activity" || configRequest) return;
      configRequest = true;
      void backend.request<{ model: string | null; modelId: string | null; thinking: string | null; expandThinking: boolean; expandTools: boolean; tools: string[]; providers: Array<{ name: string; type: string | null; models: string[] }> }>("/api/info")
        .then(info => {
          setModelLabelText(info.model ?? "No model configured"); setModelId(info.modelId ?? undefined);
          setThinking(info.thinking ?? "high"); setExpandThinking(info.expandThinking); setExpandTools(info.expandTools);
          remoteToolsRef.current = info.tools;
          setConfig(previous => ({ ...previous, ...(info.modelId ? { model: info.modelId } : {}), thinking: info.thinking ?? "high",
            providers: info.providers.map(provider => {
              const existing = previous.providers?.find(entry => entry.name === provider.name);
              return { ...existing, name: provider.name, ...(provider.type ? { type: provider.type } : {}), models: provider.models.map(id => existing?.models?.find(model => model.id === id) ?? { id, name: id }) };
            }),
          }));
        }).catch(reportRemote).finally(() => { configRequest = false; });
    });
    return () => subscription.close();
  }, [backend, sessionId, print, reportRemote]);

  const resumeSession = useCallback(
    (id: string): void => {
      if (backend) { setItems([]); setTaskViews([]); setViewedTaskId(undefined); setScrollOffset(0); setSessionId(id); onSession?.(id); return; }
      if (sessionRef.current?.id === id) { print("this session is already active."); return; }
      try {
      const store = new SessionStore({ cwd: workspace });
      const events = store.open(id, "read").all();
      const session = store.open(id, "write");
      const level = sessionThinking(events) ?? thinking;
      try {
        recordSessionModel(session, modelLabelText);
        recordSessionThinking(session, level);
        session.flush();
      } catch (error) { session.close(); throw error; }
      sessionRef.current?.close();
      runtimeRef.current?.permissions.clearSession(sessionRef.current?.id ?? "");
      sessionRef.current = session;
      historyRef.current = toChatMessages(events);
      setSessionStarted(historyRef.current.some(message => message.role !== "system"));
      setItems(messagesToItems(historyRef.current, events));
      setTaskViews(restoreTaskViews(events));
      setViewedTaskId(undefined);
      setScrollOffset(0);
      setHistory(historyRef.current.filter(message => message.role === "user").map(message => message.content).slice(-HISTORY_LIMIT));
      setTodos(sessionTodos(events));
      setJobs([]);
      setTitle(sessionTitle(events));
      titledRef.current = Boolean(sessionTitle(events));
      setSessionId(session.id);
      setThinking(level);
      onSession?.(session.id);
      print(`resumed ${session.id}`);
      } catch (error) { print(`cannot resume session: ${error instanceof Error ? error.message : "unknown error"}`); }
    },
    [backend, workspace, modelLabelText, thinking, onSession, print],
  );

  const openSessionPicker = useCallback((): void => {
    if (backend) {
      void backend.sessions().then(sessions => { if (!sessions.length) { print("no sessions to resume"); return; } setPicker({
        title: "Select a session", items: sessions.map(meta => ({ value: meta.id, label: meta.title ?? meta.id, description: meta.summary ?? new Date(meta.createdAt).toLocaleString(), group: meta.cwd ?? "Sessions" })),
        onSelect: id => { setPicker(null); resumeSession(id); },
        actions: [
          { label: "Ctrl+R rename", match: (input, key) => key.ctrl && input === "r", trigger: item => { setPicker(null); setRenameTarget({ id: item.value, title: item.label }); } },
          { label: "Ctrl+F fork", match: (input, key) => key.ctrl && input === "f", trigger: item => { setPicker(null); void backend.request<{ sessionId: string }>(`/api/sessions/${encodeURIComponent(item.value)}/fork`, {}).then(child => resumeSession(child.sessionId)).catch(reportRemote); } },
          { label: "Ctrl+D delete", match: (input, key) => key.ctrl && input === "d", trigger: item => { void backend.request(`/api/sessions/${encodeURIComponent(item.value)}`, undefined, "DELETE").then(() => { setPicker(null); if (sessionId === item.value) setSessionId(undefined); print(`deleted ${item.value}`); }).catch(reportRemote); } },
        ],
      }); }).catch(reportRemote);
      return;
    }
    const store = new SessionStore({ cwd: workspace });
    const titleOf = (id: string): string => {
      try { return sessionTitle(store.open(id, "read").all()) ?? ""; } catch { return ""; }
    };
    // Re-render the list in place after a destructive action.
    const show = (): void => {
      const options = sessionItems(store);
      if (options.length === 0) {
        setPicker(null);
        print("no sessions to resume");
        return;
      }
      setPicker({
        title: "Select a session",
        items: options,
        onSelect: (id) => { setPicker(null); resumeSession(id); },
        actions: [
          {
            label: "Ctrl+R rename",
            match: (input, key) => key.ctrl && input === "r",
            trigger: (item) => { setPicker(null); setRenameTarget({ id: item.value, title: titleOf(item.value) }); },
          },
          {
            label: "Ctrl+F fork",
            match: (input, key) => key.ctrl && input === "f",
            trigger: (item) => {
              setPicker(null);
              try { const child = forkSession(store, item.value, { cwd: workspace }); print(`forked ${item.value} into ${child}`); resumeSession(child); }
              catch (error) { print(`fork failed: ${error instanceof Error ? error.message : "unknown error"}`); }
            },
          },
          {
            label: "Ctrl+D delete",
            match: (input, key) => key.ctrl && input === "d",
            trigger: (item) => {
              if (item.value === sessionRef.current?.id) { print("cannot delete the active session."); return; }
              try { print(store.delete(item.value) ? `deleted ${item.value}` : "unknown session"); }
              catch (error) { print(`delete failed: ${error instanceof Error ? error.message : "unknown error"}`); }
              show();
            },
          },
        ],
      });
    };
    show();
  }, [backend, sessionId, reportRemote, workspace, resumeSession, print]);

  const applyRename = useCallback((value: string): void => {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) return;
    if (backend) {
      void backend.request(`/api/sessions/${encodeURIComponent(target.id)}/title`, { title: value }).catch(reportRemote);
      return;
    }
    try {
      const session = new SessionStore({ cwd: workspace }).open(target.id, "write");
      try { recordSessionTitle(session, value); session.flush(); } finally { session.close(); }
      if (sessionRef.current?.id === target.id) setTitle(value);
      print(`renamed ${target.id} to "${value}"`);
    } catch (error) {
      print(`rename failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }, [backend, reportRemote, renameTarget, workspace, print]);

  const openTaskPicker = useCallback((): void => {
    if (!taskViews.length) { print("No subagent tasks in this session."); return; }
    setPicker({
      title: "Main / Subagent views",
      items: [
        { value: "main", label: "Main conversation", group: "Main", current: viewedTaskId === undefined },
        ...taskViews.map((task, index) => ({
          value: task.id, label: `${index === taskViews.length - 1 ? "└─" : "├─"} ${task.description}`,
          description: `${task.model} · ${task.mode} · ${task.status}${task.reason ? ` · ${task.reason}` : ""}`,
          group: "Subagents", current: viewedTaskId === task.id,
        })),
      ],
      onSelect: id => { setViewedTaskId(id === "main" ? undefined : id); setScrollOffset(0); setPicker(null); },
    });
  }, [taskViews, viewedTaskId, print]);

  useEffect(() => {
    if (backend) {
      let cancelled = false;
      if (props.resumeSessionId) { setSessionId(props.resumeSessionId); onSession?.(props.resumeSessionId); }
      else if (props.pickSession) openSessionPicker();
      else void backend.createSession().then(session => { if (!cancelled) { setSessionId(session.id); onSession?.(session.id); } }).catch(reportRemote);
      return () => { cancelled = true; };
    }
    const store = new SessionStore({ cwd: workspace });
    const activate = (session: SessionHandle, history: ChatMessage[], level: string) => {
      historyRef.current = history;
      setSessionStarted(history.some(message => message.role !== "system"));
      setItems(messagesToItems(history, session.all()));
      setTaskViews(restoreTaskViews(session.all()));
      setViewedTaskId(undefined);
      setTodos(sessionTodos(session.all()));
      setJobs([]);
      setHistory(history.filter(message => message.role === "user").map(message => message.content).slice(-HISTORY_LIMIT));
      sessionRef.current = session;
      setSessionId(session.id);
      setThinking(level);
      onSession?.(session.id);
      recordSessionModel(session, props.modelLabel);
      recordSessionThinking(session, level);
      session.flush();
    };
    const defaultLevel = config.thinking ?? "high";

    if (props.resumeSessionId) {
      const events = store.open(props.resumeSessionId, "read").all();
      setTitle(sessionTitle(events));
      titledRef.current = Boolean(sessionTitle(events));
      activate(
        store.open(props.resumeSessionId, "write"),
        toChatMessages(events),
        sessionThinking(events) ?? defaultLevel,
      );
    } else if (props.pickSession) {
      const options = sessionItems(store);
      if (options.length === 0) {
        activate(store.create(), [], defaultLevel);
      } else {
        setPicker({
          title: "Select a session",
          items: options,
          onSelect: (id) => {
            setPicker(null);
            resumeSession(id);
          },
        });
      }
    } else {
      activate(store.create(), [], defaultLevel);
    }

    return () => {
      abortRef.current?.abort();
      sessionRef.current?.close();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, workspace, props.resumeSessionId, props.pickSession, props.modelLabel]);

  useEffect(() => {
    if (backend) return;
    const runtime = new RuntimeManager(workspace);
    runtimeRef.current = runtime;
    void runtime.start().catch(error => writeDiagnostic("mcp.start", String(error)));
    return () => {
      runtimeRef.current = null;
      void runtime.close().catch(error => print(`Runtime cleanup failed: ${String(error)}`));
    };
  }, [backend, workspace, print]);

  useEffect(() => {
    if (backend) return;
    const session = sessionRef.current;
    if (!session || !sessionId) return;
    const asker = new AskManager(event => {
      session.appendEvent(`ask/${event.type}`, event); session.flush();
      setQuestion(current => event.type === "requested" ? event : current?.id === event.id ? null : current);
    });
    askRef.current = asker;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    let active = true;
    let managed: ReturnType<RuntimeManager["createAgent"]> | undefined;
    const ready = resolveSelectionContext(selectModel(config)).then(limits => {
      if (!active) return;
      managed = runtime.createAgent(config, {
        model: modelRef.current,
        ...limits,
        task: true,
        taskModels: createModel ? configuredModelIds(config) : [],
        resolveTaskModel: async id => { if (!createModel) throw new Error("Model selection unavailable."); const client = await createModel({ ...config, model: id }); if (typeof client === "string") throw new Error(client); return client; },
        onJobEvent: event => {
          if (event.type === "started") {
            const data = event.data as { description: string; background: boolean };
            setJobs(previous => [...previous, { jobId: event.jobId, description: data.description, kind: event.kind, status: "running", background: data.background }]);
          } else if (["completed", "failed", "cancelled", "background"].includes(event.type)) setJobs(previous => previous.map(job => job.jobId === event.jobId ? { ...job, ...(event.type === "background" ? { background: true } : { status: event.type }) } : job));
          if (event.kind === "shell" && ["stdout", "stderr"].includes(event.type)) print(`shell ${event.jobId.slice(0, 8)} ${event.type}: ${(event.data as { content?: string }).content ?? "[truncated output]"}`);
        },
        ...(config.mode === "approval" || config.mode === "assist" || config.mode === "full" ? { accessMode: config.mode } : {}),
        onTaskEvent: event => {
          if (sessionRef.current?.id === session.id) setTaskViews(previous => applyTaskView(previous, event));
        },
        session,
        requestApproval: (request) => new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (approved: boolean) => { if (settled) return; settled = true; request.signal?.removeEventListener("abort", cancel); resolve(approved); };
          const cancel = () => { finish(false); setPending(current => current?.request === request ? null : current); };
          request.signal?.addEventListener("abort", cancel, { once: true });
          if (request.signal?.aborted) cancel(); else setPending({ request, resolve: finish });
        }),
        onEvent: (event) => {
          setItems((previous) => applyAgentEvent(previous, event));
        },
        history: historyRef.current,
        ...(modelId ? { modelId } : {}),
      }, { ask: asker.request, onTodo: setTodos, report: print });
      ringkoRef.current = managed.agent;
    }).catch(error => { if (active) print(`Model capacity initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`); });
    initializationRef.current = ready;
    return () => {
      active = false;
      managed?.close();
      asker.cancelAll(); managed?.agent.jobs.cancelAll();
      if (initializationRef.current === ready) initializationRef.current = null;
      askRef.current = null;
      ringkoRef.current = null;
    };
  }, [backend, modelVersion, modelId, workspace, config.mode, config.permission, config.workflow, config.compaction, config.providers, config.capabilities?.network, config.capabilities?.shell, sessionId, print, createModel]);

  const applyModel = useCallback(
    async (value: string): Promise<void> => {
      if (backend) {
        try { await backend.request("/api/model", { model: value }); print(`model: ${value}`); }
        catch (error) { reportRemote(error); }
        return;
      }
      const slash = value.indexOf("/");
      if (slash <= 0) {
        print("usage: /model <provider>/<model>");
        return;
      }
      const providerName = value.slice(0, slash);
      const modelIdValue = value.slice(slash + 1);
      const provider = (config.providers ?? []).find((entry) => entry.name === providerName);
      if (!provider) {
        print(`unknown provider: ${providerName}`);
        return;
      }
      if (!(provider.models ?? []).some((entry) => entry.id === modelIdValue)) {
        print(`unknown model "${modelIdValue}" for provider "${providerName}"`);
        return;
      }
      if (!createModel) {
        print("this host does not support switching models");
        return;
      }
      const next: RingkoConfig = { ...config, model: `${providerName}/${modelIdValue}` };
      if (busyRef.current) return;
      busyRef.current = true;
      setSwitching(true);
      let result: ModelClient | string;
      try { result = await createModel(next); }
      catch (error) { print(error instanceof Error ? error.message : "Cannot switch model."); return; }
      finally { busyRef.current = false; setSwitching(false); }
      if (typeof result === "string") {
        print(result);
        return;
      }
      const nextSelection = selectModel(next);
      modelRef.current = result;
      setModelVersion((version) => version + 1);
      setModelLabelText(modelLabel(nextSelection));
      setConfig(next);
      if (nextSelection) setModelId(nextSelection.model.id);
      if (sessionRef.current) {
        recordSessionModel(sessionRef.current, modelLabel(nextSelection));
        sessionRef.current.flush();
      }
      try {
        saveConfig(next);
      } catch (error) {
        print(`switched, but saving failed: ${(error as Error).message}`);
        return;
      }
      print(`model: ${modelLabel(nextSelection)}`);
    },
    [backend, reportRemote, config, print, createModel],
  );

  const pickModel = useCallback(
    (arg: string): void => {
      const trimmed = arg.trim();
      if (trimmed.length > 0) {
        void applyModel(trimmed);
        return;
      }
      const current = selectModel(config);
      const currentKey = current ? `${current.provider.name}/${current.model.id}` : "";
      const options = modelItems(config, currentKey);
      if (options.length === 0) {
        print("no models configured; edit ~/.ringko/provider.json");
        return;
      }
      setPicker({
        title: "Select a model",
        items: options,
        onSelect: (value) => {
          setPicker(null);
          void applyModel(value);
        },
      });
    },
    [config, applyModel, print],
  );

  const applyThinking = useCallback(
    async (level: string): Promise<void> => {
      const levels = ["off", "low", "high", "max"];
      if (!levels.includes(level)) {
        print(`usage: /thinking ${levels.join("|")}`);
        return;
      }
      if (backend) { try { await backend.request("/api/thinking", { level }); } catch (error) { reportRemote(error); } return; }
      const next: RingkoConfig = { ...config, thinking: level };
      if (createModel) {
        if (busyRef.current) return;
        busyRef.current = true;
        setSwitching(true);
        let result: ModelClient | string;
        try { result = await createModel(next); }
        catch (error) { print(error instanceof Error ? error.message : "Cannot change thinking level."); return; }
        finally { busyRef.current = false; setSwitching(false); }
        if (typeof result === "string") {
          print(result);
          return;
        }
        modelRef.current = result;
        setModelVersion((version) => version + 1);
      }
      setConfig(next);
      setThinking(level);
      if (sessionRef.current) {
        recordSessionThinking(sessionRef.current, level);
        sessionRef.current.flush();
      }
      try {
        saveConfig(next);
      } catch (error) {
        print(`set, but saving failed: ${(error as Error).message}`);
        return;
      }
      print(`thinking: ${level}`);
    },
    [backend, reportRemote, config, createModel, print],
  );

  const pickThinking = useCallback(
    (arg: string): void => {
      const trimmed = arg.trim().toLowerCase();
      if (trimmed.length > 0) {
        void applyThinking(trimmed);
        return;
      }
      setPicker({
        title: "Select reasoning depth",
        items: ["off", "low", "high", "max"].map((level) => ({ label: level, value: level, current: level === thinking })),
        onSelect: (value) => {
          setPicker(null);
          void applyThinking(value);
        },
      });
    },
    [applyThinking, thinking],
  );

  const compact = useCallback(
    (arg: string): void => {
      if (backend && sessionId) {
        void backend.request<{ compacted: boolean }>("/api/compact", { sessionId, instructions: arg.trim() || undefined }).then(result => print(result.compacted ? "compacted context." : "nothing to compact.")).catch(reportRemote);
        return;
      }
      const ringko = ringkoRef.current;
      if (!ringko || busyRef.current) return;
      busyRef.current = true; setSwitching(true);
      ringko
        .compact(arg.trim() || undefined)
        .then((result) => print(result.compacted ? "compacted context." : "nothing to compact."))
        .catch((error: unknown) => print(`compact failed: ${(error as Error).message}`))
        .finally(() => { historyRef.current = [...ringko.history]; busyRef.current = false; setSwitching(false); });
    },
    [backend, sessionId, reportRemote, print],
  );

  const toggleThinking = useCallback(
    (arg: string): void => {
      const trimmed = arg.trim().toLowerCase();
      const value = trimmed === "on" ? true : trimmed === "off" ? false : !expandThinking;
      if (backend) { void backend.request("/api/ui", { expandThinking: value }).catch(reportRemote); return; }
      setExpandThinking(value);
      const next: RingkoConfig = { ...config, expandThinking: value };
      setConfig(next);
      try {
        saveConfig(next);
      } catch (error) {
        print(`set, but saving failed: ${(error as Error).message}`);
        return;
      }
      print(`thinking display: ${value ? "on" : "off"}`);
    },
    [backend, reportRemote, config, expandThinking, print],
  );

  const runLogin = useCallback(
    async (providerId: string, method: string): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true; setSwitching(true);
      try {
        let credential;
        if (providerId === "github-copilot") {
          credential = await loginGitHubCopilot((url, code) => {
            setAuthBox({ title: "GitHub Copilot", url, instructions: `Enter code: ${code}` });
          });
        } else if (providerId === "xai" || providerId === "grok" || providerId === "xai-oauth") {
          credential = await loginXaiDevice((url, code) => {
            setAuthBox({ title: "xAI (Grok)", url, instructions: `Enter code: ${code}` });
          });
        } else if (providerId === "anthropic" || providerId === "claude" || providerId === "anthropic-oauth" || providerId === "claude-oauth") {
          credential = await loginAnthropic((url) => {
            setAuthBox({ title: "Anthropic · browser", url, instructions: "Complete authorization in your browser." });
            openBrowser(url);
          });
        } else if (method === "device") {
          credential = await loginOpenAiDevice((url, code) => {
            setAuthBox({ title: "OpenAI · headless", url, instructions: `Enter code: ${code}` });
          });
        } else {
          credential = await loginOpenAiBrowser((url) => {
            setAuthBox({
              title: "OpenAI · browser",
              url,
              instructions: "Complete authorization in your browser.",
            });
            openBrowser(url);
          });
        }
        setAuthBox(null);
        const type = providerId === "github-copilot"
          ? "github-copilot"
          : providerId === "xai" || providerId === "grok" || providerId === "xai-oauth"
            ? "xai-oauth"
            : providerId === "anthropic" || providerId === "claude" || providerId === "anthropic-oauth" || providerId === "claude-oauth"
              ? "anthropic-oauth"
              : "openai-oauth";
        const accountId = credential.accountId ?? credential.login ?? providerId;
        setOAuthAccount(type, { id: accountId, credential, authenticatedAt: Date.now() });
        print(`signed in to ${type} as ${credential.login ?? accountId}.`);
        let nextConfig = config;
        try {
          const discovered = await discoverModels({ type, providerId });
          if (discovered.length > 0) {
            nextConfig = upsertProviderModels(config, providerId, type, discovered);
            setConfig(nextConfig);
            saveConfig(nextConfig);
            print(`${discovered.length} model(s) available for ${providerId}.`);
          }
        } catch (error) {
          print(`signed in, but model discovery failed: ${error instanceof Error ? error.message : "unknown error"}`);
        }

        if (createModel) {
          const result = await createModel(nextConfig);
          if (typeof result === "string") {
            print(result);
            return;
          }
          modelRef.current = result;
          setModelVersion((version) => version + 1);
          print("model reloaded with new credentials.");
        }
      } catch (error) {
        setAuthBox(null);
        print(error instanceof Error ? error.message : "login failed.");
      } finally {
        busyRef.current = false; setSwitching(false);
      }
    },
    [config, createModel, print],
  );

  const login = useCallback(
    (arg: string): void => {
      const requested = arg.trim().toLowerCase();
      const options: SelectorItem[] = [];
      if (requested === "" || requested === "openai") {
        options.push(
          { label: "OpenAI · ChatGPT (browser)", value: "openai:browser" },
          { label: "OpenAI · ChatGPT (headless / device code)", value: "openai:device" },
        );
      }
      if (requested === "" || requested === "github-copilot" || requested === "copilot") {
        options.push({ label: "GitHub Copilot (device code)", value: "github-copilot:device" });
      }
      if (requested === "" || requested === "xai" || requested === "xai-oauth" || requested === "grok") {
        options.push({ label: "xAI · Grok (device code)", value: "xai-oauth:device" });
      }
      if (requested === "" || requested === "anthropic" || requested === "anthropic-oauth" || requested === "claude") {
        options.push({ label: "Anthropic · Claude Pro/Max (browser)", value: "anthropic-oauth:browser" });
      }
      if (options.length === 0) {
        print(`unsupported OAuth provider: ${arg} (supported: openai, github-copilot, xai, anthropic)`);
        return;
      }
      setPicker({
        title: "Sign in with OAuth",
        items: options,
        onSelect: (value) => {
          setPicker(null);
          const [providerId, method] = value.split(":");
          void runLogin(providerId, method);
        },
      });
    },
    [runLogin, print],
  );

  const connect = useCallback((): void => {
    const providers = config.providers ?? [];
    const presetItems: SelectorItem[] = PROVIDER_PRESETS.map((preset) => ({
      label: preset.label,
      value: `preset:${preset.id}`,
      group: "Presets",
      description: `${preset.type}${preset.baseURL ? ` · ${preset.baseURL}` : ""}`,
    }));
    const configuredItems: SelectorItem[] = providers.map((provider) => ({
      label: provider.name,
      value: `provider:${provider.name}`,
      group: "Configured",
      description: `${provider.type ?? "custom"} · ${provider.models?.length ?? 0} models`,
    }));
    setPicker({
      title: "Connect a provider",
      items: [...presetItems, ...configuredItems],
      onSelect: (value) => {
        if (value.startsWith("preset:")) {
          const preset = PROVIDER_PRESETS.find((entry) => entry.id === value.slice("preset:".length));
          if (!preset) return;
          if ((config.providers ?? []).some((provider) => provider.name === preset.id)) {
            setPicker(null);
            print(`${preset.id} is already configured.`);
            return;
          }
          const provider = { name: preset.id, type: preset.type, ...(preset.baseURL ? { baseURL: preset.baseURL } : {}) };
          const next = { ...config, providers: [...(config.providers ?? []), provider] };
          try {
            saveConfig(next);
            setConfig(next);
          } catch (error) {
            print(error instanceof Error ? error.message : "cannot save provider.");
            return;
          }
          setPicker(null);
          print(
            preset.auth === "oauth"
              ? `added ${preset.id} (${preset.type}). Run /login ${preset.id} to sign in.`
              : `added ${preset.id} (${preset.type}). Set its API key in ~/.ringko/provider.json or the WebUI, then /model.`,
          );
          return;
        }
        if (value.startsWith("provider:")) {
          const name = value.slice("provider:".length);
          const current = selectModel(config);
          const options = modelItems(config, current ? `${current.provider.name}/${current.model.id}` : "").filter((item) => item.group === name);
          if (!options.length) {
            print(`no models configured for ${name}; use ringko models ${name}`);
            return;
          }
          setPicker({ title: `${name} models`, items: options, onSelect: (model) => { setPicker(null); void applyModel(model); } });
        }
      },
    });
  }, [config, print, applyModel]);

  function interrupt(): void {
    if (backend && sessionId) { void backend.stop(sessionId).catch(reportRemote); return; }
    abortRef.current?.abort();
  }

  async function submitRemote(kind: "prompt" | "shell" | "loop", text: string): Promise<void> {
    if (!backend || busyRef.current) return;
    if (!text.trim()) { print(kind === "shell" ? "Usage: !command" : "Prompt is required."); return; }
    let id = sessionId;
    remoteSendingRef.current = true; busyRef.current = true; setRunning(true);
    try {
      if (!id) { const session = await backend.createSession(); id = session.id; setSessionId(id); onSession?.(id); }
      if (kind === "shell") await backend.request(`/api/sessions/${encodeURIComponent(id)}/shell`, { command: text });
      else if (kind === "loop") {
        const parsed = parseLoopArgs(text);
        if (!parsed.ok) throw new Error(parsed.error);
        await backend.run({ sessionId: id, prompt: parsed.options.prompt, loop: { args: text } });
      } else await backend.run({ sessionId: id, prompt: text });
    } catch (error) { reportRemote(error); }
    finally {
      remoteSendingRef.current = false;
      if (id) {
        try { const snapshot = await backend.snapshot(id); busyRef.current = snapshot.busy; setRunning(snapshot.busy); }
        catch (error) { busyRef.current = false; setRunning(false); reportRemote(error); }
      } else { busyRef.current = false; setRunning(false); }
    }
  }

  function remotePermissions(): void {
    if (!backend) return;
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    void backend.request<{ workspace: string; rules: PermissionRule[]; sessionRules: PermissionRule[] }>(`/api/permissions${query}`).then(data => {
      const entries = [...data.rules.map(rule => ({ rule, scope: "saved" as const })), ...data.sessionRules.map(rule => ({ rule, scope: "session" as const }))];
      if (!entries.length) { print("No permission rules for this workspace or session."); return; }
      setPicker({ title: "Permission rules", items: entries.map((entry, index) => ({ value: String(index), label: `${entry.rule.behavior} ${entry.rule.tool}${entry.rule.target ? `: ${entry.rule.target.slice(0, 100)}` : ""}`, group: entry.scope })),
        onSelect: value => {
          const entry = entries[Number(value)]; if (!entry) return;
          setPicker({ title: `Remove ${entry.rule.behavior} rule for ${entry.rule.tool}?`, items: [{ value: "remove", label: "Remove this rule" }, { value: "cancel", label: "Keep this rule" }],
            onSelect: choice => { setPicker(null); if (choice === "remove") void backend.request("/api/permissions", { workspace: data.workspace, sessionId, scope: entry.scope, ...entry.rule }, "DELETE").then(() => print("Permission rule removed.")).catch(reportRemote); } });
        } });
    }).catch(reportRemote);
  }

  const slash = useMemo<SlashContext>(
    () => ({
      print,
      clear: () => { setItems([]); setScrollOffset(0); },
      newSession: () => {
        if (backend) { void backend.createSession().then(session => { setItems([]); setTaskViews([]); setViewedTaskId(undefined); setSessionId(session.id); onSession?.(session.id); }).catch(reportRemote); return; }
        const session = new SessionStore({ cwd: workspace }).create();
        try {
          recordSessionModel(session, modelLabelText);
          recordSessionThinking(session, thinking);
          session.flush();
        } catch (error) { session.close(); throw error; }
        sessionRef.current?.close();
        runtimeRef.current?.permissions.clearSession(sessionRef.current?.id ?? "");
        sessionRef.current = session;
        historyRef.current = [];
        setSessionStarted(false);
        setTaskViews([]);
        setViewedTaskId(undefined);
        setItems([]); setHistory([]); setTodos([]); setTitle(undefined); setScrollOffset(0);
        titledRef.current = false;
        setSessionId(session.id);
        onSession?.(session.id);
      },
      exit: () => exit(),
      modelLabel: modelLabelText,
      workspace,
      ...(sessionId ? { sessionId } : {}),
      toolNames: () => remoteToolsRef.current ?? ringkoRef.current?.tools.list().map((tool) => tool.name) ?? [],
      managePermissions: () => {
        if (backend) { remotePermissions(); return; }
        const permissions = runtimeRef.current?.permissions;
        if (!permissions) { print("Permission manager is unavailable."); return; }
        try {
          const currentSession = sessionRef.current?.id;
          const entries: Array<{ scope: "saved" | "session"; rule: PermissionRule }> = [
            ...permissions.list("", "saved").map(rule => ({ scope: "saved" as const, rule })),
            ...(currentSession ? permissions.list(currentSession, "session").map(rule => ({ scope: "session" as const, rule })) : []),
          ];
          if (!entries.length) { print("No permission rules for this workspace or session."); return; }
          setPicker({
            title: "Permission rules",
            items: entries.map((entry, index) => ({ value: String(index), group: entry.scope === "saved" ? "Saved in workspace" : "Current session", label: `${entry.rule.behavior} ${entry.rule.tool}${entry.rule.target === undefined ? "" : `: ${entry.rule.target.slice(0, 100)}`}` })),
            onSelect: value => {
              const entry = entries[Number(value)];
              if (!entry) { setPicker(null); return; }
              setPicker({
                title: `Remove ${entry.rule.behavior} rule for ${entry.rule.tool}?`,
                items: [{ value: "remove", label: "Remove this rule" }, { value: "cancel", label: "Keep this rule" }],
                onSelect: choice => {
                  setPicker(null);
                  if (choice !== "remove") return;
                  if (entry.scope === "session" && currentSession !== sessionRef.current?.id) { print("Session changed; rule was not removed."); return; }
                  try { print(permissions.remove(currentSession ?? "", entry.rule, entry.scope) ? "Permission rule removed." : "Rule was already removed."); }
                  catch (error) { print(`Cannot remove permission rule: ${error instanceof Error ? error.message : "unknown error"}`); }
                },
              });
            },
          });
        } catch (error) { print(`Cannot list permission rules: ${error instanceof Error ? error.message : "unknown error"}`); }
      },
      showTodos: () => {
        if (!todos.length) { print("No plan steps."); return; }
        setPicker({ title: "Plan", items: todos.map((todo, index) => ({ value: String(index), label: todo.content, group: todo.status })), onSelect: value => { const todo = todos[Number(value)]; if (todo) print(`${todo.status}: ${todo.content}`); setPicker(null); } });
      },
      startLoop,
      cancelLoop,
      connect,
      login,
      pickModel,
      pickSession: openSessionPicker,
      pickAgent: openTaskPicker,
      pickThinking,
      toggleThinking,
      compact,
    }),
    [
      print,
      exit,
      modelLabelText,
      workspace,
      sessionId,
      connect,
      login,
      pickModel,
      openSessionPicker,
      openTaskPicker,
      startLoop,
      cancelLoop,
      pickThinking,
      toggleThinking,
      compact,
      thinking,
      onSession,
      todos,
      backend,
      reportRemote,
    ],
  );

  /** One agent turn: run the prompt and record the session title after the first run. */
  async function runPrompt(text: string, controller: AbortController): Promise<string> {
    await initializationRef.current;
    const ringko = ringkoRef.current;
    if (!ringko) throw new Error("Agent is not ready.");
    controller.signal.throwIfAborted();
    if (ringkoRef.current !== ringko) throw new Error("Agent changed while connecting MCP servers; retry the message.");
    const result = await ringko.run(text, { signal: controller.signal });
    const session = sessionRef.current;
    if (!titledRef.current && session) {
      titledRef.current = true;
      void generateSessionMeta(props.smallModel ?? modelRef.current, toChatMessages(session.all()), session)
        .then((meta) => { if (meta?.title) setTitle(meta.title); })
        .catch(() => {});
    }
    return result.content;
  }

  function startLoop(arg: string): void {
    if (backend) { void submitRemote("loop", arg); return; }
    if (busyRef.current) { print("a run is already in progress; wait or press Esc."); return; }
    if (loopRef.current?.active) { print("a loop is already active; use /cancel-loop first."); return; }
    const parsed = parseLoopArgs(arg);
    if (!parsed.ok) { print(parsed.error); return; }
    const state = { options: parsed.options, iteration: 0, active: true };
    loopRef.current = state;
    const shape = `${state.options.maxIterations > 0 ? `max ${state.options.maxIterations}` : "unlimited"}${state.options.completionPromise ? `, promise "${state.options.completionPromise}"` : ", no completion promise"}`;
    print(`loop started (${shape}); /cancel-loop or Esc stops it.`);
    void (async () => {
      const controller = new AbortController();
      busyRef.current = true;
      abortRef.current = controller;
      setSessionStarted(true);
      setRunning(true);
      try {
        while (state.active) {
          state.iteration += 1;
          setLoopStatus(`loop ${state.iteration}${state.options.maxIterations > 0 ? `/${state.options.maxIterations}` : ""}${state.options.completionPromise ? ` → ${state.options.completionPromise}` : ""}`);
          setItems(previous => [...previous, state.iteration === 1 ? userItem(state.options.prompt) : noticeItem(`loop iteration ${state.iteration}`)]);
          const content = await runPrompt(loopPrompt(state.options), controller);
          historyRef.current = sessionRef.current ? toChatMessages(sessionRef.current.all()) : (ringkoRef.current ? [...ringkoRef.current.history] : historyRef.current);
          const promise = state.options.completionPromise;
          if (promise && promiseText(content) === promise) { print(`loop complete after ${state.iteration} iteration(s): <promise>${promise}</promise>`); break; }
          if (state.options.maxIterations > 0 && state.iteration >= state.options.maxIterations) { print(`loop stopped at its ${state.options.maxIterations}-iteration limit.`); break; }
          controller.signal.throwIfAborted();
        }
      } catch (error) {
        if (controller.signal.aborted) print("loop interrupted.");
        else setItems(previous => [...previous, { id: nextId(), kind: "assistant", text: `loop error: ${(error as Error).message}`, failed: true }]);
      } finally {
        if (loopRef.current === state) loopRef.current = null;
        setLoopStatus(undefined);
        setItems(finishPendingTools);
        busyRef.current = false;
        abortRef.current = null;
        setRunning(false);
      }
    })();
  }

  function cancelLoop(): void {
    if (backend && sessionId) { void backend.stop(sessionId).catch(reportRemote); return; }
    if (!loopRef.current?.active) { print("no active loop."); return; }
    loopRef.current.active = false;
    abortRef.current?.abort();
    print("loop cancelled.");
  }

  async function submit(input: string): Promise<void> {
    if (busyRef.current) return;
    if (!backend) await initializationRef.current;
    if (busyRef.current) return;
    setHistory(previous => [...previous.filter(value => value !== input), input].slice(-HISTORY_LIMIT));
    setScrollOffset(0);
    const parsed = parseInput(input);
    if (backend && (parsed.kind === "shell" || parsed.kind === "prompt")) {
      await submitRemote(parsed.kind === "shell" ? "shell" : "prompt", parsed.value);
      return;
    }
    if (parsed.kind === "shell") {
      if (!parsed.value) { print("Usage: !command (for example !git status)"); return; }
      setSessionStarted(true);
      const id = nextId();
      const controller = new AbortController();
      busyRef.current = true;
      abortRef.current = controller;
      setRunning(true);
      setItems(previous => [...previous, { id, kind: "tool", toolName: "shell", arguments: { command: parsed.value }, text: "", running: true }]);
      try {
        const result = await runLocalShell(parsed.value, workspace, controller.signal);
        setItems(previous => previous.map(item => item.id === id ? { ...item, running: false, failed: result.exitCode !== 0 || result.timedOut === true, text: JSON.stringify(result) } : item));
      } catch (error) {
        const text = controller.signal.aborted ? "Interrupted" : error instanceof Error ? error.message : "Shell command failed.";
        setItems(previous => previous.map(item => item.id === id ? { ...item, running: false, failed: true, text } : item));
      } finally {
        busyRef.current = false;
        abortRef.current = null;
        setRunning(false);
      }
      return;
    }
    if (parsed.kind === "unknown") {
      setItems((previous) => [...previous, noticeItem(`Unknown command: /${parsed.name} (try /help)`)]);
      return;
    }
    if (parsed.kind === "command") {
      const command = findCommand(parsed.name);
      if (!command) {
        setItems((previous) => [...previous, noticeItem(`Unknown command: /${parsed.name} (try /help)`)]);
        return;
      }
      try { command.run(slash, parsed.arg); }
      catch (error) { print(`command failed: ${error instanceof Error ? error.message : "unknown error"}`); }
      return;
    }

    if (!ringkoRef.current) return;
    busyRef.current = true;
    setSessionStarted(true);
    setItems((previous) => [...previous, userItem(parsed.value)]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runPrompt(parsed.value, controller);
    } catch (error) {
      const interrupted = controller.signal.aborted;
      setItems((previous) => [
        ...previous,
        {
          id: nextId(),
          kind: "assistant",
          text: interrupted ? "interrupted" : `error: ${(error as Error).message}`,
          failed: true,
        },
      ]);
    } finally {
      historyRef.current = sessionRef.current ? toChatMessages(sessionRef.current.all()) : (ringkoRef.current ? [...ringkoRef.current.history] : historyRef.current);
      setItems(finishPendingTools);
      busyRef.current = false;
      abortRef.current = null;
      setRunning(false);
    }
  }

  useInput((input, key) => {
    if (running && !question && !pending && key.ctrl && input === "b") {
      if (backend && sessionId) {
        const foreground = jobs.find(job => job.status === "running" && !job.background);
        if (foreground) void backend.request(`/api/sessions/${encodeURIComponent(sessionId)}/jobs`, { jobId: foreground.jobId, action: "background" }).catch(reportRemote);
        return;
      }
      const foreground = ringkoRef.current?.jobs.list().find(job => job.status === "running" && !job.background);
      if (foreground) { ringkoRef.current?.jobs.detach(foreground.jobId); print(`job ${foreground.jobId} moved to background`); }
    }
  });

  useInput((input, key) => {
    if (pending && key.ctrl && input === "c") {
      pending.resolve(false); setPending(null); interrupt();
    }
  }, { isActive: Boolean(pending) });

  function answer(approved: boolean, scope?: "session" | "saved"): void {
    if (approved && scope) pending?.request.remember?.(scope);
    pending?.resolve(approved);
    setPending(null);
  }

  function handleShortcut(action: Shortcut): void {
    if (action === "pageUp" || action === "pageDown") {
      const page = Math.max(1, Math.floor(transcriptSize.height) - 2);
      setScrollOffset(previous => Math.max(0, previous + (action === "pageUp" ? page : -page)));
      return;
    }
    if (switching && action !== "copy") { print("wait for the current configuration operation."); return; }
    if (action === "thinking") { toggleThinking(""); return; }
    if (action === "agents") { openTaskPicker(); return; }
    if (action === "tools") {
      const value = !expandTools;
      if (backend) { void backend.request("/api/ui", { expandTools: value }).catch(reportRemote); return; }
      setExpandTools(value);
      const next = { ...config, expandTools: value };
      setConfig(next);
      try { saveConfig(next); } catch (error) { print(`display changed, but saving failed: ${error instanceof Error ? error.message : "unknown error"}`); }
      return;
    }
    if (action === "copy") {
      const visible = taskViews.find(task => task.id === viewedTaskId)?.items ?? items;
      const last = [...visible].reverse().find(item => item.kind === "assistant");
      if (last) { copyToClipboard(last.text); print("last answer sent to clipboard."); }
      else print("no assistant answer to copy.");
      return;
    }
    if (busyRef.current) { print("wait for the current operation, or press Esc to interrupt."); return; }
    if (action === "model") pickModel("");
    else if (action === "sessions") openSessionPicker();
    else if (action === "effort") {
      const levels = ["off", "low", "high", "max"];
      void applyThinking(levels[(levels.indexOf(thinking) + 1) % levels.length]);
    } else if (action === "nextModel" || action === "previousModel") {
      const current = selectModel(config);
      const key = current ? `${current.provider.name}/${current.model.id}` : "";
      const next = nextModel(modelItems(config, key), key, action === "nextModel" ? 1 : -1);
      if (next) void applyModel(next); else pickModel("");
    }
  }

  const modal = Boolean(pending || question?.input || authBox || picker || renameTarget);
  const layout = terminalLayout(size.rows, modal);
  const selectedTask = taskViews.find(task => task.id === viewedTaskId);
  const visibleItems = selectedTask?.items ?? items;
  return (
    <Box flexDirection="column" width={size.columns} height={layout.height}>
      {!sessionStarted ? <Banner modelLabel={modelLabelText} workspace={workspace} /> : null}
      {!modal && taskViews.length > 0 ? <TaskTree tasks={taskViews} selectedId={selectedTask?.id} columns={size.columns} maxRows={layout.compact ? 1 : Math.min(6, Math.floor(layout.height / 6) + 1)} /> : null}
      <Box ref={transcriptBox} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} justifyContent={!sessionStarted ? "flex-start" : "flex-end"} overflowY="hidden">
        <Transcript viewKey={`${sessionId ?? "new"}:${viewedTaskId ?? "main"}`} items={visibleItems} expandThinking={expandThinking} expandTools={expandTools} columns={size.columns} rows={Math.floor(transcriptSize.height)} offset={scrollOffset} onOffset={setScrollOffset} />
        {!sessionStarted ? <Box flexDirection="column" paddingX={2} marginTop={1} marginBottom={1}>
          <Text bold color={theme.brand}>What would you like to work on?</Text>
          <Text color={theme.dim}>/connect providers · /model models · /resume sessions</Text>
          <Text color={theme.dim}>Ctrl+L models · Shift+Tab effort · /shortcuts keyboard help</Text>
        </Box> : null}
      </Box>
      {running ? <Spinner /> : null}
      {switching ? <Spinner label="Applying changes" /> : null}
      <TodoPanel todos={todos} maxRows={layout.todoRows} />
      {layout.jobRows > 0 && jobs.some(job => job.status === "running") ? <Box flexDirection="column" paddingX={1} flexShrink={0}>{jobs.filter(job => job.status === "running").slice(-1).map(job => <Text key={job.jobId} color={theme.dim}>{fitTerminalLine(`${job.kind} ${job.jobId.slice(0, 8)} · ${job.background ? "background" : "foreground"} · ${job.description}`, size.columns - 2)}</Text>)}<Text color={theme.dim}>{fitTerminalLine("Ctrl+B move foreground job to background", size.columns - 2)}</Text></Box> : null}
      {pending ? <ApprovalDialog request={pending.request} onAnswer={answer} /> : null}
      {pending ? null : question?.input ? <AskDialog key={question.id} input={question.input} onAnswer={output => backend ? void backend.request("/api/ask", { id: question.id, output }).catch(reportRemote) : askRef.current?.respond(question.id, output)} onCancel={() => backend ? void backend.request("/api/ask", { id: question.id, cancel: true }).catch(reportRemote) : askRef.current?.respond(question.id)} /> : authBox ? (
        <AuthDialog
          auth={authBox}
          onCopied={(label) => print(`${label} copied to clipboard.`)}
          onClose={() => setAuthBox(null)}
        />
      ) : renameTarget ? (
        <RenameInput initial={renameTarget.title} onSubmit={applyRename} onCancel={() => setRenameTarget(null)} />
      ) : picker ? (
        <Selector
          title={picker.title}
          items={picker.items}
          onSelect={picker.onSelect}
          onCancel={() => setPicker(null)}
          actions={picker.actions}
        />
      ) : (
        <PromptInput maxEditorLines={layout.inputRows} running={running || switching} editor={editor} onEdit={setEditor} history={history} onSubmit={submit} onShortcut={handleShortcut} onInterrupt={interrupt} />
      )}
      <StatusBar
        modelLabel={thinking === "off" ? `${modelLabelText} • thinking off` : `${modelLabelText} • ${thinking}`}
        workspace={workspace}
        title={selectedTask ? `Subagent: ${selectedTask.description}` : title}
        columns={size.columns}
        compact={layout.compact || modal}
        loop={loopStatus}
      />
    </Box>
  );
}
