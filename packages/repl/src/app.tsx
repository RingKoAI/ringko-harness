import { Box, Text, useApp, useInput, useStdout, useBoxMetrics, type DOMElement } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ChatMessage, type ModelClient, type RingKo, type ToolApprovalRequest } from "@ringko-ai/sdk";
import {
  AskManager,
  type AskEvent,
  type TodoItem,
} from "@ringko-ai/tools";
import { TodoPanel } from "./components/TodoPanel.tsx";
import {
  SessionStore,
  recordSessionModel,
  recordSessionThinking,
  recordSessionTitle,
  sessionThinking,
  sessionTitle,
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
  setOAuthAccount,
  upsertProviderModels,
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
import { Selector, type SelectorItem } from "./components/Selector.tsx";
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
import { terminalLayout } from "./terminal-layout.ts";
import { fitTerminalLine } from "./editor.ts";

export interface ReplProps {
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
}

async function generateTitle(
  smallModel: ModelClient,
  prompt: string,
  session: SessionHandle,
  setTitle: (value: string) => void,
): Promise<void> {
  try {
    const turn = await smallModel({
      messages: [
        { role: "user", content: `Reply with a very short title (max 6 words, no quotes) for this task: ${prompt}` },
      ],
      tools: [],
    });
    const generated = turn.content.trim().replace(/\s+/g, " ").slice(0, 60);
    if (generated.length > 0) {
      recordSessionTitle(session, generated);
      session.flush();
      setTitle(generated);
    }
  } catch {
    // title generation is best-effort
  }
}

function sessionItems(store: SessionStore, limit = 20): SelectorItem[] {
  return store
    .list()
    .slice(0, limit)
    .map((meta) => ({
      label: (() => { try { return sessionTitle(store.open(meta.id, "read").all()) ?? meta.id; } catch { return meta.id; } })(),
      description: `${new Date(meta.header.createdAt).toLocaleString()} · ${meta.id}`,
      group: meta.header.cwd ?? "Sessions",
      value: meta.id,
    }));
}

export function Repl(props: ReplProps) {
  const { exit } = useApp();
  const { createModel, workspace, onSession } = props;

  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });

  useEffect(() => {
    const update = () => setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
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
  const sessionRef = useRef<SessionHandle | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const titledRef = useRef(false);

  const print = useCallback((text: string) => setItems((previous) => [...previous, noticeItem(text)]), []);

  const resumeSession = useCallback(
    (id: string): void => {
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
      setItems(messagesToItems(historyRef.current, events));
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
    [workspace, modelLabelText, thinking, onSession, print],
  );

  const openSessionPicker = useCallback((): void => {
    const store = new SessionStore({ cwd: workspace });
    const options = sessionItems(store);
    if (options.length === 0) {
      print("no sessions to resume");
      return;
    }
    setPicker({
      title: "Select a session",
      items: options,
      onSelect: (id) => {
        setPicker(null);
        resumeSession(id);
      },
    });
  }, [workspace, resumeSession, print]);

  useEffect(() => {
    const store = new SessionStore({ cwd: workspace });
    const activate = (session: SessionHandle, history: ChatMessage[], level: string) => {
      historyRef.current = history;
      setItems(messagesToItems(history, session.all()));
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
  }, [workspace, props.resumeSessionId, props.pickSession, props.modelLabel]);

  useEffect(() => {
    const runtime = new RuntimeManager(workspace);
    runtimeRef.current = runtime;
    return () => {
      runtimeRef.current = null;
      void runtime.close().catch(error => print(`Runtime cleanup failed: ${String(error)}`));
    };
  }, [workspace, print]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !sessionId) return;
    const asker = new AskManager(event => {
      session.appendEvent(`ask/${event.type}`, event); session.flush();
      setQuestion(current => event.type === "requested" ? event : current?.id === event.id ? null : current);
    });
    askRef.current = asker;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const managed = runtime.createAgent(config, {
      model: modelRef.current,
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
        if (event.type !== "event") print(`task ${event.taskId.slice(0, 8)} [${event.mode}] ${event.model} ${event.type}: ${event.description}${event.reason ? ` (${event.reason})` : ""}`);
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
    const ringko = managed.agent;
    ringkoRef.current = ringko;
    return () => {
      managed.close();
      asker.cancelAll(); ringko.jobs.cancelAll();
      askRef.current = null;
      ringkoRef.current = null;
    };
  }, [modelVersion, modelId, workspace, config.mode, config.permission, config.workflow, config.compaction, config.providers, config.capabilities?.network, config.capabilities?.shell, sessionId, print, createModel]);

  const applyModel = useCallback(
    async (value: string): Promise<void> => {
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
    [config, print, createModel],
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
    [config, createModel, print],
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
      const ringko = ringkoRef.current;
      if (!ringko || busyRef.current) return;
      busyRef.current = true; setSwitching(true);
      ringko
        .compact(arg.trim() || undefined)
        .then((result) => print(result.compacted ? "compacted context." : "nothing to compact."))
        .catch((error: unknown) => print(`compact failed: ${(error as Error).message}`))
        .finally(() => { historyRef.current = [...ringko.history]; busyRef.current = false; setSwitching(false); });
    },
    [print],
  );

  const toggleThinking = useCallback(
    (arg: string): void => {
      const trimmed = arg.trim().toLowerCase();
      const value = trimmed === "on" ? true : trimmed === "off" ? false : !expandThinking;
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
    [config, expandThinking, print],
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

  const slash = useMemo<SlashContext>(
    () => ({
      print,
      clear: () => { setItems([]); setScrollOffset(0); },
      newSession: () => {
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
        setItems([]); setHistory([]); setTodos([]); setTitle(undefined); setScrollOffset(0);
        titledRef.current = false;
        setSessionId(session.id);
        onSession?.(session.id);
      },
      exit: () => exit(),
      modelLabel: modelLabelText,
      workspace,
      ...(sessionId ? { sessionId } : {}),
      toolNames: () => ringkoRef.current?.tools.list().map((tool) => tool.name) ?? [],
      managePermissions: () => {
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
        if (!todos.length) { print("No todos."); return; }
        setPicker({ title: "Todos", items: todos.map((todo, index) => ({ value: String(index), label: todo.content, group: todo.status })), onSelect: value => { const todo = todos[Number(value)]; if (todo) print(`${todo.status}: ${todo.content}`); setPicker(null); } });
      },
      connect,
      login,
      pickModel,
      pickSession: openSessionPicker,
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
      pickThinking,
      toggleThinking,
      compact,
      thinking,
      onSession,
      todos,
    ],
  );

  async function submit(input: string): Promise<void> {
    if (busyRef.current) return;
    setHistory(previous => [...previous.filter(value => value !== input), input].slice(-HISTORY_LIMIT));
    setScrollOffset(0);
    const parsed = parseInput(input);
    if (parsed.kind === "shell") {
      if (!parsed.value) { print("Usage: !command (for example !git status)"); return; }
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

    const ringko = ringkoRef.current;
    if (!ringko) return;
    busyRef.current = true;
    setItems((previous) => [...previous, userItem(parsed.value)]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      controller.signal.throwIfAborted();
      if (ringkoRef.current !== ringko) throw new Error("Agent changed while connecting MCP servers; retry the message.");
      await ringko.run(parsed.value, { signal: controller.signal });
      if (!titledRef.current && props.smallModel && sessionRef.current) {
        titledRef.current = true;
        void generateTitle(props.smallModel, parsed.value, sessionRef.current, setTitle);
      }
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
      historyRef.current = sessionRef.current ? toChatMessages(sessionRef.current.all()) : [...ringko.history];
      setItems(finishPendingTools);
      busyRef.current = false;
      abortRef.current = null;
      setRunning(false);
    }
  }

  useInput((input, key) => {
    if (running && !question && !pending && key.ctrl && input === "b") {
      const foreground = ringkoRef.current?.jobs.list().find(job => job.status === "running" && !job.background);
      if (foreground) { ringkoRef.current?.jobs.detach(foreground.jobId); print(`job ${foreground.jobId} moved to background`); }
    }
  });

  useInput((input, key) => {
    if (pending && key.ctrl && input === "c") {
      pending.resolve(false); setPending(null); abortRef.current?.abort();
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
    if (action === "tools") {
      const value = !expandTools;
      setExpandTools(value);
      const next = { ...config, expandTools: value };
      setConfig(next);
      try { saveConfig(next); } catch (error) { print(`display changed, but saving failed: ${error instanceof Error ? error.message : "unknown error"}`); }
      return;
    }
    if (action === "copy") {
      const last = [...items].reverse().find(item => item.kind === "assistant");
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

  const modal = Boolean(pending || question?.input || authBox || picker);
  const layout = terminalLayout(size.rows, modal);
  return (
    <Box flexDirection="column" width={size.columns} height={layout.height}>
      <Banner modelLabel={modelLabelText} workspace={workspace} />
      <Box ref={transcriptBox} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} justifyContent={items.length === 0 ? "flex-start" : "flex-end"} overflowY="hidden">
        <Transcript items={items} expandThinking={expandThinking} expandTools={expandTools} columns={size.columns} rows={Math.floor(transcriptSize.height)} offset={scrollOffset} onOffset={setScrollOffset} />
        {items.length === 0 ? <Box flexDirection="column" paddingX={2} marginTop={1} marginBottom={1}>
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
      {pending ? null : question?.input ? <AskDialog key={question.id} input={question.input} onAnswer={output => askRef.current?.respond(question.id, output)} onCancel={() => askRef.current?.respond(question.id)} /> : authBox ? (
        <AuthDialog
          auth={authBox}
          onCopied={(label) => print(`${label} copied to clipboard.`)}
          onClose={() => setAuthBox(null)}
        />
      ) : picker ? (
        <Selector
          title={picker.title}
          items={picker.items}
          onSelect={picker.onSelect}
          onCancel={() => setPicker(null)}
        />
      ) : (
        <PromptInput maxEditorLines={layout.inputRows} running={running || switching} editor={editor} onEdit={setEditor} history={history} onSubmit={submit} onShortcut={handleShortcut} onInterrupt={() => abortRef.current?.abort()} />
      )}
      <StatusBar
        modelLabel={thinking === "off" ? `${modelLabelText} • thinking off` : `${modelLabelText} • ${thinking}`}
        workspace={workspace}
        title={title}
        columns={size.columns}
        compact={layout.compact || modal}
      />
    </Box>
  );
}
