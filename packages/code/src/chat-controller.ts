import { randomUUID } from "node:crypto";
import {
  applyToolInputDelta,
  BackendError,
  consumeSse,
  restoreTranscript,
  SYNC_LIMITS,
  type Approval,
  type BackendClient,
  type BusyEnterMode,
  type PartialResponse,
  type PendingSteer,
  type QuestionOutput,
  type QuestionRequest,
  type SessionMeta,
  type SessionSnapshot,
  type SessionUsage,
  type SyncNotice,
  type TodoItem,
} from "@ringko-ai/client";
import type { BackendManager, BackendManagerStatus } from "./backend-manager.ts";
import { DEFAULT_ATTACHMENT_PROMPTS, IDE_LIMITS } from "./limits.ts";
import type {
  IdeMessageView,
  IdeModelOption,
  IdeQueuedPrompt,
  IdeSessionSummary,
  IdeToolCallView,
  IdeUiState,
  IdeUploadedAttachment,
  IncomingUploadFile,
  PermissionPreset,
} from "./webview-protocol.ts";

interface BackendInfoResponse {
  modelId: string | null;
  permissionPreset?: PermissionPreset;
  busyEnter?: BusyEnterMode;
  providers?: Array<{
    name: string;
    type: string | null;
    models: string[];
  }>;
}

interface UploadResponse {
  files: Array<{ name: string; path: string; size: number }>;
}

export interface ChatControllerOptions {
  backend: BackendManager;
  locale?: "en" | "zh-CN";
  onApprovalRequested?: (approval: Approval) => void;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

function formatToolArgs(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === undefined || raw === null) return "";
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

function stripAttachedSuffix(text: string): string {
  return text.replace(/\n\nAttached files \(read them if relevant\): [^\n]+$/, "");
}

/** Project a durable `SessionSnapshot` into IDE transcript items with paired tool calls/results. */
export function snapshotToMessages(snapshot: SessionSnapshot): IdeMessageView[] {
  const restored = restoreTranscript(
    snapshot.messages,
    snapshot.events,
    snapshot.busy,
    Boolean(snapshot.error),
  );

  const toolCallLookup = new Map<string, IdeToolCallView>();
  const seenUserRuns = new Set<number>();
  const views: IdeMessageView[] = [];

  for (let index = 0; index < restored.length; index++) {
    const entry = restored[index]!;
    if (entry.role === "tool") {
      if (entry.toolCallId && toolCallLookup.has(entry.toolCallId)) {
        const call = toolCallLookup.get(entry.toolCallId)!;
        call.resultText = entry.content;
        call.failed = entry.failed === true;
        call.running = false;
      } else {
        views.push({
          id: `msg-${entry.sourceSeq ?? index}`,
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: entry.toolCallId ?? `tool-${index}`,
              name: entry.name ?? "tool",
              argsText: "",
              resultText: entry.content,
              failed: entry.failed === true,
              running: false,
            },
          ],
        });
      }
      continue;
    }

    let steered = false;
    if (entry.role === "user" && entry.runStart !== undefined) {
      if (seenUserRuns.has(entry.runStart)) steered = true;
      else seenUserRuns.add(entry.runStart);
    }

    const toolCalls: IdeToolCallView[] | undefined = entry.toolCalls?.length
      ? entry.toolCalls.map(call => {
        const view: IdeToolCallView = {
          id: call.id,
          name: call.name,
          argsText: formatToolArgs(call.arguments),
          running: snapshot.busy,
        };
        toolCallLookup.set(call.id, view);
        return view;
      })
      : undefined;

    views.push({
      id: `msg-${entry.sourceSeq ?? index}`,
      role: entry.role,
      content: entry.role === "user" ? stripAttachedSuffix(entry.content) : entry.content,
      ...(entry.reasoning ? { reasoning: entry.reasoning } : {}),
      ...(steered ? { steered: true } : {}),
      ...(entry.runStatus ? { runStatus: entry.runStatus } : {}),
      ...(toolCalls ? { toolCalls } : {}),
    });
  }

  // If the run has finished, no recorded tool call is still running.
  if (!snapshot.busy) {
    for (const call of toolCallLookup.values()) {
      call.running = false;
    }
  }

  if (snapshot.busy && snapshot.partial) {
    const partialTools: IdeToolCallView[] = (snapshot.partial.toolInputs ?? []).map(tool => ({
      id: tool.id,
      name: tool.name || "tool",
      argsText: tool.text,
      running: true,
    }));
    if (snapshot.partial.content || snapshot.partial.reasoning || partialTools.length > 0) {
      views.push({
        id: "partial-live",
        role: "assistant",
        content: snapshot.partial.content,
        ...(snapshot.partial.reasoning ? { reasoning: snapshot.partial.reasoning } : {}),
        streaming: true,
        runStatus: "running",
        ...(partialTools.length > 0 ? { toolCalls: partialTools } : {}),
      });
    }
  }

  return views;
}

export class ChatController {
  private readonly backend: BackendManager;
  private readonly locale: "en" | "zh-CN";
  private readonly onApprovalRequested: ((approval: Approval) => void) | undefined;
  private readonly customFetch: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;

  private sessionId: string | null = null;
  private sessions: IdeSessionSummary[] = [];
  private modelId: string | null = null;
  private models: IdeModelOption[] = [];
  private permissionPreset: PermissionPreset = "default";
  private busyEnter: BusyEnterMode = "queue";

  private snapshot: SessionSnapshot | null = null;
  private liveStreamActive = false;
  private livePartial: PartialResponse | null = null;
  private liveApprovals = new Map<string, Approval>();
  private liveQuestions = new Map<string, QuestionRequest>();
  private liveSteering: PendingSteer[] = [];
  private optimisticUserPrompt: string | null = null;
  private liveError: string | null = null;

  private readonly queues = new Map<string, IdeQueuedPrompt[]>();
  private attachments: IdeUploadedAttachment[] = [];
  private uploadingCount = 0;
  private drainingQueue = false;
  private reconcilingStream = false;
  private disposed = false;

  private globalSyncSub: { close(): void } | null = null;
  private sessionWatchSub: { close(): void } | null = null;
  private activeStreamAbort: AbortController | null = null;
  private readonly unsubscribeBackend: () => void;
  private readonly listeners = new Set<(state: IdeUiState) => void>();
  private readonly notifiedApprovals = new Set<string>();

  constructor(options: ChatControllerOptions) {
    this.backend = options.backend;
    this.locale = options.locale ?? "en";
    this.onApprovalRequested = options.onApprovalRequested;
    this.customFetch = options.fetch;

    this.unsubscribeBackend = this.backend.subscribe(status => {
      this.handleBackendStatus(status);
    });
  }

  subscribe(listener: (state: IdeUiState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): IdeUiState {
    const connection = this.backend.getStatus();
    const busy = this.liveStreamActive || Boolean(this.snapshot?.busy);
    const activeKey = this.queueKey(this.sessionId);
    const queue = [...(this.queues.get(activeKey) ?? [])];

    const approvalsMap = new Map<string, Approval>();
    for (const item of this.snapshot?.approvals ?? []) approvalsMap.set(item.id, item);
    for (const [id, item] of this.liveApprovals) approvalsMap.set(id, item);

    const questionsMap = new Map<string, QuestionRequest>();
    for (const item of this.snapshot?.questions ?? []) questionsMap.set(item.id, item);
    for (const [id, item] of this.liveQuestions) questionsMap.set(id, item);

    const steeringMap = new Map<string, PendingSteer>();
    for (const item of this.snapshot?.steering ?? []) steeringMap.set(item.id, item);
    for (const item of this.liveSteering) steeringMap.set(item.id, item);

    let messages: IdeMessageView[] = [];
    if (this.snapshot) {
      const effectiveSnapshot: SessionSnapshot = this.livePartial
        ? { ...this.snapshot, busy: true, partial: this.livePartial }
        : this.snapshot;
      messages = snapshotToMessages(effectiveSnapshot);
    }
    if (this.optimisticUserPrompt && messages.length === 0) {
      messages = [
        {
          id: "optimistic-user",
          role: "user",
          content: this.optimisticUserPrompt,
          runStatus: "running",
        },
      ];
      if (this.livePartial && (this.livePartial.content || this.livePartial.reasoning || (this.livePartial.toolInputs?.length ?? 0) > 0)) {
        messages.push({
          id: "partial-live",
          role: "assistant",
          content: this.livePartial.content,
          ...(this.livePartial.reasoning ? { reasoning: this.livePartial.reasoning } : {}),
          streaming: true,
          runStatus: "running",
          ...(this.livePartial.toolInputs?.length
            ? {
              toolCalls: this.livePartial.toolInputs.map(tool => ({
                id: tool.id,
                name: tool.name || "tool",
                argsText: tool.text,
                running: true,
              })),
            }
            : {}),
        });
      }
    }

    return {
      connection,
      sessionId: this.sessionId,
      sessions: this.sessions,
      busy,
      busyEnter: this.busyEnter,
      modelId: this.modelId,
      models: this.models,
      permissionPreset: this.permissionPreset,
      messages,
      pendingSteers: [...steeringMap.values()],
      queue,
      approvals: [...approvalsMap.values()],
      questions: [...questionsMap.values()],
      todos: this.snapshot?.todos ?? [],
      usage: this.snapshot?.usage ?? null,
      attachments: [...this.attachments],
      uploadingCount: this.uploadingCount,
      error: this.liveError ?? this.snapshot?.error ?? connection.error,
    };
  }

  async initialize(): Promise<void> {
    try {
      const client = await this.backend.connect();
      this.attachGlobalSync(client);
      await Promise.all([this.refreshInfo(client), this.refreshSessions(client)]);
      if (!this.sessionId && this.sessions.length > 0) {
        await this.selectSession(this.sessions[0]!.id);
      } else {
        this.emit();
      }
    } catch {
      this.emit();
    }
  }

  async reconnect(): Promise<void> {
    this.closeSubscriptions();
    try {
      const client = await this.backend.reconnect();
      this.attachGlobalSync(client);
      await Promise.all([this.refreshInfo(client), this.refreshSessions(client)]);
      if (this.sessionId) {
        await this.selectSession(this.sessionId);
      } else if (this.sessions.length > 0) {
        await this.selectSession(this.sessions[0]!.id);
      } else {
        this.emit();
      }
    } catch {
      this.emit();
    }
  }

  async createNewSession(): Promise<string> {
    const client = await this.backend.connect();
    const created = await client.createSession();
    await this.refreshSessions(client);
    await this.selectSession(created.id);
    return created.id;
  }

  async selectSession(id: string): Promise<void> {
    if (!id) return;
    const client = await this.backend.connect();
    this.sessionWatchSub?.close();
    this.sessionWatchSub = null;
    this.sessionId = id;
    this.clearLiveEphemeral();
    this.liveError = null;

    const snap = await client.snapshot(id);
    this.applySnapshot(snap);

    this.sessionWatchSub = client.watchSession(
      id,
      nextSnap => {
        if (this.sessionId !== id) return;
        this.applySnapshot(nextSnap);
      },
      () => {
        // Sync transient error is surfaced via BackendManager if the lease drops.
      },
    );
  }

  /** Send a prompt immediately if idle, or enqueue it if the active session is busy. */
  async sendOrEnqueue(rawPrompt: string): Promise<void> {
    const { prompt, attachmentPaths } = this.consumeComposerInput(rawPrompt);
    if (!prompt) return;

    if (this.getState().busy) {
      this.enqueueInternal(prompt, attachmentPaths);
      return;
    }
    await this.startChatStream(prompt, attachmentPaths);
  }

  /** Explicitly enqueue a prompt for FIFO execution after the active turn completes. */
  enqueue(rawPrompt: string): void {
    const { prompt, attachmentPaths } = this.consumeComposerInput(rawPrompt);
    if (!prompt) return;
    this.enqueueInternal(prompt, attachmentPaths);
  }

  /** Inject a mid-run steering message at the next step boundary, falling back to send if idle. */
  async steer(rawPrompt: string): Promise<void> {
    const { prompt, attachmentPaths } = this.consumeComposerInput(rawPrompt);
    if (!prompt) return;
    await this.steerWithAttachments(prompt, attachmentPaths);
  }

  async steerQueued(queueItemId: string): Promise<void> {
    const key = this.queueKey(this.sessionId);
    const list = this.queues.get(key) ?? [];
    const index = list.findIndex(item => item.id === queueItemId);
    if (index < 0) return;
    const [item] = list.splice(index, 1);
    if (!item) return;
    this.queues.set(key, list);
    this.emit();
    try {
      await this.steerWithAttachments(item.prompt, item.attachments);
    } catch (error) {
      const current = this.queues.get(key) ?? [];
      this.queues.set(key, [item, ...current]);
      this.liveError = error instanceof Error ? error.message : "Failed to steer queued message.";
      this.emit();
    }
  }

  async steerAllQueued(): Promise<void> {
    const key = this.queueKey(this.sessionId);
    const list = [...(this.queues.get(key) ?? [])];
    if (list.length === 0) return;
    this.queues.set(key, []);
    this.emit();
    for (let index = 0; index < list.length; index++) {
      const item = list[index]!;
      try {
        await this.steerWithAttachments(item.prompt, item.attachments);
      } catch (error) {
        const remaining = list.slice(index);
        this.queues.set(key, [...remaining, ...(this.queues.get(key) ?? [])]);
        this.liveError = error instanceof Error ? error.message : "Failed to steer queued messages.";
        this.emit();
        return;
      }
    }
  }

  removeQueued(queueItemId: string): void {
    const key = this.queueKey(this.sessionId);
    const list = this.queues.get(key);
    if (!list) return;
    this.queues.set(key, list.filter(item => item.id !== queueItemId));
    this.emit();
  }

  removeAttachment(attachmentId: string): void {
    this.attachments = this.attachments.filter(item => item.id !== attachmentId);
    this.emit();
  }

  async uploadFiles(files: ReadonlyArray<IncomingUploadFile>): Promise<void> {
    if (files.length === 0) return;
    const remainingSlots = IDE_LIMITS.maxUploadFiles - this.attachments.length;
    if (remainingSlots <= 0) {
      this.liveError = `At most ${IDE_LIMITS.maxUploadFiles} attachments may be staged per message.`;
      this.emit();
      return;
    }

    const accepted = files.slice(0, remainingSlots);
    const decoded: Array<{ meta: IncomingUploadFile; bytes: Uint8Array<ArrayBuffer> }> = [];
    for (const file of accepted) {
      const buffer = Buffer.from(file.base64, "base64");
      if (buffer.byteLength === 0 || buffer.byteLength > IDE_LIMITS.maxUploadFileBytes) {
        this.liveError = `File "${file.name}" exceeds the 20 MiB upload limit or is empty.`;
        this.emit();
        return;
      }
      decoded.push({ meta: file, bytes: Uint8Array.from(buffer) });
    }

    // Group into batches <= maxUploadBatchBytes to respect UPLOAD_LIMITS.pending = 2.
    const batches: Array<Array<{ meta: IncomingUploadFile; bytes: Uint8Array<ArrayBuffer> }>> = [];
    let currentBatch: Array<{ meta: IncomingUploadFile; bytes: Uint8Array<ArrayBuffer> }> = [];
    let currentBytes = 0;
    for (const item of decoded) {
      if (currentBatch.length > 0 && currentBytes + item.bytes.byteLength > IDE_LIMITS.maxUploadBatchBytes) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBytes = 0;
      }
      currentBatch.push(item);
      currentBytes += item.bytes.byteLength;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    this.uploadingCount += decoded.length;
    this.liveError = null;
    this.emit();

    try {
      await this.backend.connect();
      const status = this.backend.getStatus();
      if (!status.url) throw new Error("Backend URL is unavailable.");

      for (const batch of batches) {
        const form = new FormData();
        for (const entry of batch) {
          const blob = new Blob([entry.bytes], { type: entry.meta.type || "application/octet-stream" });
          form.append("file", blob, entry.meta.name);
        }
        const headers = new Headers();
        const token = this.backend.getAuthToken();
        if (token) headers.set("authorization", `Bearer ${token}`);
        headers.set("x-ringko-workspace", encodeURIComponent(this.backend.getWorkspace()));

        const response = await (this.customFetch ?? fetch)(`${status.url}/api/upload`, {
          method: "POST",
          headers,
          body: form,
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        });
        if (!response.ok) {
          const errPayload = await response.json().catch(() => null) as { error?: unknown } | null;
          throw new Error(typeof errPayload?.error === "string" ? errPayload.error : `Upload failed (${response.status}).`);
        }
        const payload = await response.json() as UploadResponse;
        for (let idx = 0; idx < payload.files.length; idx++) {
          const saved = payload.files[idx]!;
          const source = batch[idx]?.meta;
          this.attachments.push({
            id: randomUUID(),
            name: saved.name,
            path: saved.path,
            size: saved.size,
            ...(source?.previewDataUrl ? { previewDataUrl: source.previewDataUrl } : {}),
          });
        }
      }
    } catch (error) {
      this.liveError = error instanceof Error ? error.message : "Attachment upload failed.";
    } finally {
      this.uploadingCount = Math.max(0, this.uploadingCount - decoded.length);
      this.emit();
    }
  }

  async stop(): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    // Clear pending queue on explicit stop so queued prompts do not auto-fire after cancellation.
    this.queues.delete(this.queueKey(id));
    try {
      const client = await this.backend.connect();
      await client.stop(id);
    } catch (error) {
      if (!(error instanceof BackendError && error.status === 404)) {
        this.liveError = error instanceof Error ? error.message : "Failed to stop active run.";
      }
    } finally {
      this.activeStreamAbort?.abort();
      this.emit();
    }
  }

  async decideApproval(id: string, approved: boolean, scope?: "session" | "saved"): Promise<void> {
    const client = await this.backend.connect();
    await client.request("/api/approval", { id, approved, ...(scope ? { scope } : {}) }, "POST");
    this.liveApprovals.delete(id);
    this.emit();
  }

  async answerQuestion(id: string, output?: QuestionOutput, cancel?: boolean): Promise<void> {
    const client = await this.backend.connect();
    await client.request(
      "/api/ask",
      cancel ? { id, cancel: true } : { id, output },
      "POST",
    );
    this.liveQuestions.delete(id);
    this.emit();
  }

  async setModel(model: string): Promise<void> {
    const client = await this.backend.connect();
    const info = await client.request<BackendInfoResponse>("/api/model", { model }, "POST");
    this.applyInfo(info);
    this.emit();
  }

  async setAccessPreset(preset: PermissionPreset): Promise<void> {
    const client = await this.backend.connect();
    const info = await client.request<BackendInfoResponse>("/api/access", { preset }, "POST");
    this.applyInfo(info);
    this.emit();
  }

  async setBusyEnter(busyEnter: BusyEnterMode): Promise<void> {
    const client = await this.backend.connect();
    const info = await client.request<BackendInfoResponse>("/api/ui", { busyEnter }, "POST");
    this.applyInfo(info);
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeBackend();
    this.activeStreamAbort?.abort();
    this.closeSubscriptions();
    this.listeners.clear();
  }

  private consumeComposerInput(rawPrompt: string): { prompt: string; attachmentPaths: string[] } {
    const trimmed = rawPrompt.trim();
    const staged = this.attachments;
    if (!trimmed && staged.length === 0) {
      return { prompt: "", attachmentPaths: [] };
    }
    const prompt = trimmed || DEFAULT_ATTACHMENT_PROMPTS[this.locale];
    const attachmentPaths = staged.map(item => item.path);
    this.attachments = [];
    return { prompt, attachmentPaths };
  }

  private enqueueInternal(prompt: string, attachments: string[]): void {
    const key = this.queueKey(this.sessionId);
    const current = this.queues.get(key) ?? [];
    if (current.length >= IDE_LIMITS.maxQueueItems) {
      this.liveError = `At most ${IDE_LIMITS.maxQueueItems} messages may be queued.`;
      this.emit();
      return;
    }
    current.push({ id: randomUUID(), prompt, attachments });
    this.queues.set(key, current);
    this.liveError = null;
    this.emit();
  }

  private async steerWithAttachments(prompt: string, attachments: string[]): Promise<void> {
    const id = this.sessionId;
    if (!id || !this.getState().busy) {
      await this.startChatStream(prompt, attachments);
      return;
    }

    const steerId = randomUUID();
    const displayContent = prompt;
    this.liveSteering.push({ id: steerId, content: displayContent });
    this.liveError = null;
    this.emit();

    try {
      const client = await this.backend.connect();
      await client.steer(id, {
        id: steerId,
        prompt,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } catch (error) {
      this.liveSteering = this.liveSteering.filter(item => item.id !== steerId);
      if (error instanceof BackendError && error.status === 409) {
        // Active run finished right before steer landed — fall back to a fresh turn.
        await this.startChatStream(prompt, attachments);
        return;
      }
      this.liveError = error instanceof Error ? error.message : "Steering failed.";
      this.emit();
      throw error;
    }
  }

  private async startChatStream(prompt: string, attachments: string[]): Promise<void> {
    const client = await this.backend.connect();
    const status = this.backend.getStatus();
    if (!status.url) throw new Error("Backend URL is unavailable.");

    const previousKey = this.queueKey(this.sessionId);
    const streamAbort = new AbortController();
    this.activeStreamAbort = streamAbort;
    this.liveStreamActive = true;
    this.liveError = null;
    this.livePartial = { content: "", reasoning: "" };
    this.optimisticUserPrompt = prompt;
    this.emit();

    try {
      const headers = new Headers({ "content-type": "application/json" });
      const token = this.backend.getAuthToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
      headers.set("x-ringko-workspace", encodeURIComponent(this.backend.getWorkspace()));

      const response = await (this.customFetch ?? fetch)(`${status.url}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt,
          ...(this.sessionId ? { sessionId: this.sessionId } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
        signal: streamAbort.signal,
        redirect: "error",
      });

      if (!response.ok) {
        const errValue = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new BackendError(
          response.status,
          typeof errValue?.error === "string" ? errValue.error : `Chat request failed (${response.status}).`,
        );
      }

      await consumeSse(
        response,
        (event, data) => {
          this.handleChatStreamEvent(event, data, previousKey, client);
        },
        streamAbort.signal,
      );
    } catch (error) {
      if (!streamAbort.signal.aborted) {
        this.liveError = error instanceof Error ? error.message : "Run failed.";
      }
    } finally {
      if (this.activeStreamAbort === streamAbort) {
        this.activeStreamAbort = null;
      }
      this.liveStreamActive = false;
      this.optimisticUserPrompt = null;
      this.clearLiveEphemeral();

      if (!this.disposed) {
        this.reconcilingStream = true;
        try {
          await this.refreshSessions(client);
          if (this.sessionId) {
            const snap = await client.snapshot(this.sessionId);
            this.applySnapshot(snap);
          } else {
            this.emit();
          }
        } catch {
          this.emit();
        } finally {
          this.reconcilingStream = false;
        }
        if (!streamAbort.signal.aborted && !this.liveError && !this.snapshot?.error) {
          await this.maybeDrainQueue();
        }
      }
    }
  }

  private handleChatStreamEvent(
    event: string,
    data: unknown,
    previousQueueKey: string,
    client: BackendClient,
  ): void {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    if (event === "session" && typeof record.sessionId === "string") {
      const resolvedId = record.sessionId;
      if (this.sessionId !== resolvedId) {
        this.migrateQueue(previousQueueKey, this.queueKey(resolvedId));
        this.sessionId = resolvedId;
        this.sessionWatchSub?.close();
        this.sessionWatchSub = client.watchSession(resolvedId, snap => {
          if (this.sessionId === resolvedId) this.applySnapshot(snap);
        });
      }
      this.emit();
      return;
    }

    if (event === "delta") {
      const kind = record.kind === "reasoning" ? "reasoning" : "content";
      const text = typeof record.text === "string" ? record.text : "";
      const current = this.livePartial ?? { content: "", reasoning: "" };
      this.livePartial = {
        ...current,
        [kind]: `${current[kind]}${text}`.slice(0, SYNC_LIMITS.partialCharacters),
      };
      this.emit();
      return;
    }

    if (event === "tool_input") {
      const current = this.livePartial ?? { content: "", reasoning: "" };
      this.livePartial = {
        ...current,
        toolInputs: applyToolInputDelta(current.toolInputs, data),
      };
      this.emit();
      return;
    }

    if (event === "steering" && typeof record.id === "string" && typeof record.content === "string") {
      if (!this.liveSteering.some(item => item.id === record.id)) {
        this.liveSteering.push({ id: record.id, content: stripAttachedSuffix(record.content) });
      }
      this.emit();
      return;
    }

    if (event === "user") {
      if (typeof record.id === "string") {
        this.liveSteering = this.liveSteering.filter(item => item.id !== record.id);
      }
      this.emit();
      return;
    }

    if (event === "assistant") {
      this.livePartial = null;
      this.emit();
      return;
    }

    if (event === "approval" && typeof record.id === "string") {
      const approval = data as Approval;
      this.liveApprovals.set(approval.id, approval);
      this.notifyApprovalOnce(approval);
      this.emit();
      return;
    }

    if (event === "approval_closed" && typeof record.id === "string") {
      this.liveApprovals.delete(record.id);
      this.emit();
      return;
    }

    if (event === "ask" && typeof record.id === "string") {
      this.liveQuestions.set(record.id, data as QuestionRequest);
      this.emit();
      return;
    }

    if (event === "ask_closed" && typeof record.id === "string") {
      this.liveQuestions.delete(record.id);
      this.emit();
      return;
    }

    if (event === "todo" && Array.isArray(record.items) && this.snapshot) {
      this.snapshot = { ...this.snapshot, todos: record.items as TodoItem[] };
      this.emit();
      return;
    }

    if (event === "usage" && record.usage && this.snapshot) {
      this.snapshot = { ...this.snapshot, usage: record.usage as SessionUsage };
      this.emit();
      return;
    }

    if (event === "error" && typeof record.message === "string") {
      this.liveError = record.message;
      this.livePartial = null;
      this.liveSteering = [];
      this.emit();
      return;
    }

    if (event === "cancelled") {
      this.livePartial = null;
      this.liveSteering = [];
      this.emit();
    }
  }

  private applySnapshot(snap: SessionSnapshot): void {
    const wasBusy = Boolean(this.snapshot?.busy);
    this.snapshot = snap;
    if (snap.messages.length > 0) {
      this.optimisticUserPrompt = null;
    }
    for (const approval of snap.approvals) {
      this.notifyApprovalOnce(approval);
    }
    if (!snap.busy && !this.liveStreamActive) {
      this.clearLiveEphemeral();
    }
    this.emit();

    if (wasBusy && !snap.busy && !this.liveStreamActive && !this.reconcilingStream && !snap.error) {
      void this.maybeDrainQueue();
    }
  }

  private async maybeDrainQueue(): Promise<void> {
    if (this.drainingQueue || this.disposed || this.getState().busy) return;
    const key = this.queueKey(this.sessionId);
    const list = this.queues.get(key);
    if (!list || list.length === 0) return;
    const next = list.shift()!;
    this.queues.set(key, list);
    this.drainingQueue = true;
    this.emit();
    try {
      await this.startChatStream(next.prompt, next.attachments);
    } finally {
      this.drainingQueue = false;
    }
  }

  private async refreshInfo(client: BackendClient): Promise<void> {
    const info = await client.request<BackendInfoResponse>("/api/info");
    this.applyInfo(info);
  }

  private applyInfo(info: BackendInfoResponse): void {
    this.modelId = info.modelId ?? null;
    if (info.permissionPreset) this.permissionPreset = info.permissionPreset;
    if (info.busyEnter) this.busyEnter = info.busyEnter;
    const options: IdeModelOption[] = [];
    for (const provider of info.providers ?? []) {
      for (const model of provider.models ?? []) {
        const fullId = `${provider.name}/${model}`;
        options.push({ id: fullId, label: fullId });
      }
    }
    this.models = options;
  }

  private async refreshSessions(client: BackendClient): Promise<void> {
    const raw: SessionMeta[] = await client.sessions();
    this.sessions = raw
      .filter(entry => !entry.archived)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(entry => ({
        id: entry.id,
        title: entry.title?.trim() || entry.id.slice(0, 8),
        busy: Boolean(entry.busy),
        createdAt: entry.createdAt,
      }));
  }

  private attachGlobalSync(client: BackendClient): void {
    this.globalSyncSub?.close();
    this.globalSyncSub = client.watch((notice: SyncNotice) => {
      if (this.disposed) return;
      if (notice.kind === "config" || notice.kind === "reset") {
        void this.refreshInfo(client).then(() => this.emit()).catch(() => {});
      }
      if (notice.kind === "session" || notice.kind === "reset") {
        void this.refreshSessions(client).then(() => this.emit()).catch(() => {});
      }
    });
  }

  private handleBackendStatus(status: BackendManagerStatus): void {
    if (status.state === "disconnected" || status.state === "error") {
      this.closeSubscriptions();
    }
    this.emit();
  }

  private notifyApprovalOnce(approval: Approval): void {
    if (this.notifiedApprovals.has(approval.id)) return;
    this.notifiedApprovals.add(approval.id);
    if (this.notifiedApprovals.size > 256) {
      const oldest = this.notifiedApprovals.values().next().value;
      if (oldest !== undefined) this.notifiedApprovals.delete(oldest);
    }
    this.onApprovalRequested?.(approval);
  }

  private clearLiveEphemeral(): void {
    this.livePartial = null;
    this.liveApprovals.clear();
    this.liveQuestions.clear();
    this.liveSteering = [];
  }

  private queueKey(sessionId: string | null): string {
    return sessionId ?? "__draft__";
  }

  private migrateQueue(fromKey: string, toKey: string): void {
    if (fromKey === toKey) return;
    const fromItems = this.queues.get(fromKey);
    if (!fromItems || fromItems.length === 0) return;
    this.queues.delete(fromKey);
    const existing = this.queues.get(toKey) ?? [];
    this.queues.set(toKey, [...existing, ...fromItems]);
  }

  private closeSubscriptions(): void {
    this.globalSyncSub?.close();
    this.globalSyncSub = null;
    this.sessionWatchSub?.close();
    this.sessionWatchSub = null;
  }

  private emit(): void {
    if (this.disposed) return;
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate observer callbacks.
      }
    }
  }
}
