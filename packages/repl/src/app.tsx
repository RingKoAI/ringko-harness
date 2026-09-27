import { Box, useApp } from "ink";
import { useEffect, useRef, useState } from "react";
import { createRingKo, type ModelClient, type RingKo, type ToolApprovalRequest } from "@ringko-ai/sdk";
import { registerNetworkTools, registerShellTools, registerWorkspaceTools } from "@ringko-ai/tools";
import { SessionStore, type SessionHandle } from "@ringko-ai/session";
import type { RingkoConfig } from "@ringko-ai/config";
import { Banner } from "./components/Banner.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { PromptInput } from "./components/PromptInput.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ApprovalDialog } from "./components/ApprovalDialog.tsx";
import { HELP_TEXT, parseCommand } from "./commands.ts";
import { agentEventToItems, nextId, noticeItem, userItem, type ReplItem } from "./state.ts";

export interface ReplProps {
  model: ModelClient;
  modelLabel: string;
  config: RingkoConfig;
  workspace: string;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
}

export function Repl({ model, modelLabel, config, workspace }: ReplProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<ReplItem[]>([]);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const ringkoRef = useRef<RingKo | null>(null);
  const sessionRef = useRef<SessionHandle | null>(null);

  useEffect(() => {
    const session = new SessionStore({ cwd: workspace }).create();
    sessionRef.current = session;
    setSessionId(session.id);

    const ringko = createRingKo({
      model,
      session,
      requestApproval: (request) => new Promise<boolean>((resolve) => setPending({ request, resolve })),
      onEvent: (event) => {
        const mapped = agentEventToItems(event);
        if (mapped.length > 0) setItems((previous) => [...previous, ...mapped]);
      },
    });
    registerWorkspaceTools(ringko.tools, { workspace });
    if (config.capabilities?.network) registerNetworkTools(ringko.tools);
    if (config.capabilities?.shell) registerShellTools(ringko.tools, { cwd: workspace });
    ringkoRef.current = ringko;

    return () => {
      session.close();
      ringkoRef.current = null;
      sessionRef.current = null;
    };
  }, [model, workspace, config]);

  async function submit(input: string): Promise<void> {
    const parsed = parseCommand(input);
    if (parsed.kind === "exit") {
      exit();
      return;
    }
    if (parsed.kind === "clear") {
      setItems([]);
      return;
    }
    if (parsed.kind === "help") {
      setItems((previous) => [...previous, noticeItem(HELP_TEXT)]);
      return;
    }
    if (parsed.kind === "unknown") {
      setItems((previous) => [...previous, noticeItem(`Unknown command: /${parsed.name} (try /help)`)]);
      return;
    }

    const ringko = ringkoRef.current;
    if (!ringko) return;
    setItems((previous) => [...previous, userItem(parsed.value)]);
    setRunning(true);
    try {
      await ringko.run(parsed.value);
    } catch (error) {
      setItems((previous) => [
        ...previous,
        { id: nextId(), kind: "assistant", text: `error: ${(error as Error).message}`, failed: true },
      ]);
    } finally {
      setRunning(false);
    }
  }

  function answer(approved: boolean): void {
    setPending((current) => {
      current?.resolve(approved);
      return null;
    });
  }

  return (
    <Box flexDirection="column">
      <Banner modelLabel={modelLabel} workspace={workspace} />
      <Transcript items={items} />
      {running ? <Spinner /> : null}
      {pending ? <ApprovalDialog request={pending.request} onAnswer={answer} /> : null}
      {pending ? null : <PromptInput running={running} onSubmit={submit} />}
      <StatusBar modelLabel={modelLabel} workspace={workspace} sessionId={sessionId} />
    </Box>
  );
}
