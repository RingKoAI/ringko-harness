import { SYNC_LIMITS, type BackendIdentity, type RunInput, type SessionMeta, type SessionSnapshot, type SyncNotice } from "@ringko-ai/protocol";
export * from "@ringko-ai/protocol";

export class BackendError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = "BackendError"; }
}
export interface ClientOptions { url?: string; token?: string | (() => string | null); workspace?: string; fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response> }

/** Both browser and terminal hosts use the same authenticated transport. No node imports. */
export class BackendClient {
  private readonly options: ClientOptions;
  constructor(options: ClientOptions = {}) { this.options = options; }
  async request<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
    if (!path.startsWith("/api/")) throw new TypeError("Only backend API paths are supported.");
    const headers = this.headers();
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await (this.options.fetch ?? fetch)(`${this.options.url ?? ""}${path}`, {
      method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: signal ?? AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!response.ok) {
      const value = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new BackendError(response.status, typeof value?.error === "string" ? value.error : `Backend request failed (${response.status}).`);
    }
    return await response.json() as T;
  }
  identity(signal?: AbortSignal): Promise<BackendIdentity> { return this.request("/api/backend", undefined, "GET", signal); }
  sessions(): Promise<SessionMeta[]> { return this.request("/api/sessions"); }
  createSession(): Promise<SessionMeta> { return this.request("/api/sessions", {}, "POST"); }
  snapshot(id: string, signal?: AbortSignal): Promise<SessionSnapshot> { return this.request(`/api/sessions/${encodeURIComponent(id)}/snapshot`, undefined, "GET", signal); }
  run(input: RunInput): Promise<{ sessionId: string }> { return this.request("/api/runs", input); }
  stop(id: string): Promise<unknown> { return this.request(`/api/sessions/${encodeURIComponent(id)}/stop`, {}); }
  /** At most one snapshot request in flight. Invalidations received during it trigger another read. */
  watchSession(id: string, onSnapshot: (snapshot: SessionSnapshot) => void, onError?: (error: Error) => void, onNotice?: (notice: SyncNotice) => void): { close(): void } {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fetching = false;
    let dirty = false;
    const refresh = () => {
      dirty = true;
      if (timer || fetching || controller.signal.aborted) return;
      timer = setTimeout(() => {
        timer = undefined; fetching = true; dirty = false;
        void this.snapshot(id, controller.signal).then(snapshot => { if (!controller.signal.aborted) onSnapshot(snapshot); })
          .catch(cause => { if (!controller.signal.aborted) onError?.(cause instanceof Error ? cause : new Error(String(cause))); })
          .finally(() => { fetching = false; if (dirty) refresh(); });
      }, SYNC_LIMITS.refreshMs);
    };
    const subscription = this.watch(notice => {
      onNotice?.(notice);
      if (!notice.sessionId || notice.sessionId === id) refresh();
    }, onError);
    refresh();
    return { close: () => { controller.abort(); clearTimeout(timer); subscription.close(); } };
  }
  private headers(): Headers {
    const headers = new Headers();
    const token = typeof this.options.token === "function" ? this.options.token() : this.options.token;
    if (token) headers.set("authorization", `Bearer ${token}`);
    if (this.options.workspace) headers.set("x-ringko-workspace", encodeURIComponent(this.options.workspace));
    return headers;
  }
  /** Reconnects with a reset notification: hosts must fetch authoritative snapshots after every reconnect. */
  watch(onNotice: (notice: SyncNotice) => void, onError?: (error: Error) => void): { close(): void } {
    const controller = new AbortController();
    let delay: number = SYNC_LIMITS.reconnectMs;
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await (this.options.fetch ?? fetch)(`${this.options.url ?? ""}/api/sync`, { headers: this.headers(), signal: controller.signal, redirect: "error" });
          if (!response.ok) throw new BackendError(response.status, `Sync connection failed (${response.status}).`);
          delay = SYNC_LIMITS.reconnectMs;
          await consumeSse(response, (event, value) => { if (event === "sync") onNotice(value as SyncNotice); }, controller.signal);
          if (!controller.signal.aborted) throw new Error("Backend sync disconnected; reconnecting.");
        } catch (cause) {
          if (controller.signal.aborted) break;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          onError?.(error);
          if (error instanceof BackendError && [401, 403, 409].includes(error.status)) break;
        }
        await wait(delay, controller.signal);
        delay = Math.min(delay * 2, SYNC_LIMITS.maxReconnectMs);
      }
    })();
    return { close: () => controller.abort() };
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Bounded SSE decoding, shared by long-lived synchronization and streaming chat. */
export async function consumeSse(response: Response, dispatch: (event: string, data: unknown) => void, signal?: AbortSignal): Promise<void> {
  if (!response.body) throw new Error("Missing event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > SYNC_LIMITS.frameBytes) throw new Error("Event stream frame exceeds the size limit.");
      let end: number;
      while ((end = pending.search(/\r?\n\r?\n/)) >= 0) {
        const delimiter = pending.slice(end).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
        const frame = pending.slice(0, end); pending = pending.slice(end + delimiter.length);
        let event = "message";
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trimStart();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) dispatch(event, JSON.parse(data.join("\n")));
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
