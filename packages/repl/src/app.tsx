import { Box, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRingKo, type ChatMessage, type ModelClient, type RingKo, type ToolApprovalRequest } from "@ringko-ai/sdk";
import {
  createTodoStore,
  createTodoTool,
  registerNetworkTools,
  registerShellTools,
  registerWorkspaceTools,
  type TodoItem,
} from "@ringko-ai/tools";
import { TodoPanel } from "./components/TodoPanel.tsx";
import {
  SessionStore,
  recordSessionModel,
  recordSessionThinking,
  recordSessionTitle,
  sessionThinking,
  toChatMessages,
  type SessionHandle,
} from "@ringko-ai/session";
import {
  modelLabel,
  saveConfig,
  selectModel,
  setAuth,
  upsertProviderModels,
  type RingkoConfig,
} from "@ringko-ai/config";
import { discoverModels } from "@ringko-ai/providers";
import { loginGitHubCopilot, loginOpenAiBrowser, loginOpenAiDevice, openBrowser } from "@ringko-ai/auth";
import { Banner } from "./components/Banner.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { PromptInput } from "./components/PromptInput.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ApprovalDialog } from "./components/ApprovalDialog.tsx";
import { AuthDialog, type AuthBox } from "./components/AuthDialog.tsx";
import { Selector, type SelectorItem } from "./components/Selector.tsx";
import { findCommand, parseInput, type SlashContext } from "./commands.ts";
import { agentEventToItems, nextId, noticeItem, userItem, type ReplItem } from "./state.ts";

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
      label: `${new Date(meta.header.createdAt).toISOString()}  ${meta.header.cwd ?? ""}`,
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

  // Full-screen: enter the alternate buffer so the UI fills the terminal and
  // does not pollute scrollback.
  useEffect(() => {
    stdout.write("\u001b[?1049h");
    return () => {
      stdout.write("\u001b[?1049l");
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
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [authBox, setAuthBox] = useState<AuthBox | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [modelId, setModelId] = useState<string | undefined>(props.modelId);
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [thinking, setThinking] = useState<string>(props.config.thinking ?? "high");
  const [expandThinking, setExpandThinking] = useState<boolean>(props.config.expandThinking ?? false);
  const ringkoRef = useRef<RingKo | null>(null);
  const sessionRef = useRef<SessionHandle | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const titledRef = useRef(false);

  const print = useCallback((text: string) => setItems((previous) => [...previous, noticeItem(text)]), []);

  const resumeSession = useCallback(
    (id: string): void => {
      const store = new SessionStore({ cwd: workspace });
      const events = store.open(id, "read").all();
      sessionRef.current?.close();
      const session = store.open(id, "write");
      sessionRef.current = session;
      historyRef.current = toChatMessages(events);
      setSessionId(session.id);
      const level = sessionThinking(events) ?? thinking;
      setThinking(level);
      onSession?.(session.id);
      recordSessionModel(session, modelLabelText);
      recordSessionThinking(session, level);
      session.flush();
      print(`resumed ${session.id}`);
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
      sessionRef.current?.close();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, props.resumeSessionId, props.pickSession, props.modelLabel]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const ringko = createRingKo({
      model: modelRef.current,
      session,
      requestApproval: (request) => new Promise<boolean>((resolve) => setPending({ request, resolve })),
      onEvent: (event) => {
        const mapped = agentEventToItems(event);
        if (mapped.length > 0) setItems((previous) => [...previous, ...mapped]);
      },
      history: historyRef.current,
      ...(modelId ? { modelId } : {}),
    });
    registerWorkspaceTools(ringko.tools, { workspace });
    ringko.tools.register(createTodoTool(createTodoStore(setTodos)));
    if (config.capabilities?.network) registerNetworkTools(ringko.tools);
    if (config.capabilities?.shell) registerShellTools(ringko.tools, { cwd: workspace });
    ringkoRef.current = ringko;
    return () => {
      ringkoRef.current = null;
    };
  }, [modelVersion, modelId, workspace, config, sessionId]);

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
      const result = await createModel(next);
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
      const options: SelectorItem[] = [];
      for (const provider of config.providers ?? []) {
        for (const entry of provider.models ?? []) {
          const value = `${provider.name}/${entry.id}`;
          options.push({ label: `${provider.name}/${entry.name}`, value, current: value === currentKey });
        }
      }
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
        const result = await createModel(next);
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
      try {
        let credential;
        if (providerId === "github-copilot") {
          credential = await loginGitHubCopilot((url, code) => {
            setAuthBox({ title: "GitHub Copilot", url, instructions: `Enter code: ${code}` });
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
        setAuth(providerId, credential);
        const account = credential.accountId ? ` (account ${credential.accountId})` : "";
        print(`signed in to ${providerId}${account}.`);

        const type = providerId === "github-copilot" ? "github-copilot" : "openai-oauth";
        let nextConfig = config;
        try {
          const discovered = await discoverModels({ type, providerId });
          if (discovered.length > 0) {
            nextConfig = upsertProviderModels(config, providerId, type, discovered);
            setConfig(nextConfig);
            saveConfig(nextConfig);
            print(`${discovered.length} model(s) available for ${providerId}.`);
          }
        } catch {
          // Non-fatal: discovery is best-effort.
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
      if (options.length === 0) {
        print(`unsupported OAuth provider: ${arg} (supported: openai, github-copilot)`);
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
    if (providers.length === 0) {
      print("no providers configured; edit ~/.ringko/provider.json");
      return;
    }
    for (const provider of providers) {
      const models = (provider.models ?? []).map((entry) => entry.id).join(", ");
      print(`${provider.name} (${provider.type ?? "?"})  ${models}`);
    }
    print(`current: ${modelLabel(selectModel(config))} · switch with /model`);
  }, [config, print]);

  const slash = useMemo<SlashContext>(
    () => ({
      print,
      clear: () => setItems([]),
      exit: () => exit(),
      modelLabel: modelLabelText,
      workspace,
      ...(sessionId ? { sessionId } : {}),
      toolNames: () => ringkoRef.current?.tools.list().map((tool) => tool.name) ?? [],
      connect,
      login,
      pickModel,
      pickSession: openSessionPicker,
      pickThinking,
      toggleThinking,
    }),
    [print, exit, modelLabelText, workspace, sessionId, connect, login, pickModel, openSessionPicker, pickThinking, toggleThinking],
  );

  async function submit(input: string): Promise<void> {
    const parsed = parseInput(input);
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
      command.run(slash, parsed.arg);
      return;
    }

    const ringko = ringkoRef.current;
    if (!ringko) return;
    setItems((previous) => [...previous, userItem(parsed.value)]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
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
      abortRef.current = null;
      setRunning(false);
    }
  }

  useInput((_input, key) => {
    if (key.escape && running && !picker && !pending) {
      abortRef.current?.abort();
    }
  });

  function answer(approved: boolean): void {
    setPending((current) => {
      current?.resolve(approved);
      return null;
    });
  }

  return (
    <Box flexDirection="column" width={size.columns} height={size.rows}>
      <Banner modelLabel={modelLabelText} workspace={workspace} />
      <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" overflowY="hidden">
        <Transcript items={items} expandThinking={expandThinking} />
      </Box>
      {running ? <Spinner /> : null}
      <TodoPanel todos={todos} />
      {pending ? <ApprovalDialog request={pending.request} onAnswer={answer} /> : null}
      {pending ? null : authBox ? (
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
        <PromptInput running={running} onSubmit={submit} />
      )}
      <StatusBar
        modelLabel={thinking === "off" ? `${modelLabelText} • thinking off` : `${modelLabelText} • ${thinking}`}
        workspace={workspace}
        title={title}
      />
    </Box>
  );
}
