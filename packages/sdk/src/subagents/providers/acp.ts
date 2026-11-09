import { randomUUID } from "node:crypto";
import type {
  SubagentCatalogEntry,
  SubagentProvider,
  SubagentProviderContext,
  SubagentResult,
  SubagentRunHandle,
  SubagentStartInput,
  SubagentStopReason,
} from "../types.ts";
import { spawnProcess, type SpawnedProcess } from "./process.ts";
import { SUBAGENT_LIMITS } from "../types.ts";

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

class JsonLineConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  constructor(
    private readonly process: SpawnedProcess,
    private readonly onNotification: (method: string, params: unknown) => void,
    private readonly onRequest: (method: string, params: unknown) => Promise<unknown>,
  ) {
    void this.pump();
    void this.process.exited.catch(error => this.fail(error instanceof Error ? error : new Error(String(error))));
  }

  private async pump(): Promise<void> {
    try {
      await this.process.lines(line => {
        if (!line.trim()) return;
        let message: RpcMessage;
        try { message = JSON.parse(line) as RpcMessage; } catch { return; }
        if (message.id !== undefined && message.method) {
          void this.onRequest(message.method, message.params).then(
            result => this.write({ jsonrpc: "2.0", id: message.id!, result }),
            error => this.write({ jsonrpc: "2.0", id: message.id!, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }),
          );
        } else if (message.id !== undefined) {
          const pending = this.pending.get(Number(message.id));
          if (!pending) return;
          this.pending.delete(Number(message.id));
          if (message.error) pending.reject(new Error(message.error.message ?? "ACP request failed."));
          else pending.resolve(message.result);
        } else if (message.method) {
          this.onNotification(message.method, message.params);
        }
      });
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    this.fail(new Error("ACP connection closed."));
  }

  private write(value: unknown): void {
    if (this.closed) return;
    try { this.process.writeStdin(`${JSON.stringify(value)}\n`); }
    catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); void this.process.kill(); }
  }

  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("ACP connection closed."));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const settle = (error?: Error, value?: unknown) => { this.pending.delete(id); signal?.removeEventListener("abort", onAbort); if (error) reject(error); else resolve(value); };
      const onAbort = () => settle(new Error("ACP request aborted."));
      this.pending.set(id, { resolve: value => settle(undefined, value), reject: error => settle(error) });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close(): void {
    this.fail(new Error("ACP connection closed."));
  }
}

export interface AcpProviderOptions {
  name?: string;
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  inheritEnv?: readonly string[];
  permission?: "allow" | "reject";
  timeoutMs?: number;
  disposeGraceMs?: number;
  /** Override shell spawning; defaults to true on Windows for .cmd shims. */
  shell?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stopReason(value: unknown): SubagentStopReason {
  switch (value) {
    case "end_turn": return "completed";
    case "max_tokens": return "max_tokens";
    case "refusal": return "refusal";
    case "cancelled": return "aborted";
    default: return "error";
  }
}

/**
 * Agent Client Protocol backend: one isolated child process per run, a fresh
 * session, text streaming, unattended permission policy, and explicit
 * cancellation. ACP providers execute once and cannot accept follow-ups.
 */
export class AcpProvider implements SubagentProvider {
  readonly name: string;
  readonly kind = "acp";
  readonly description = "Runs an isolated ACP agent in a fresh subprocess.";
  readonly capabilities = Object.freeze({
    continuable: false,
    resume: false,
    modelSelection: false,
    tools: false,
    approvals: false,
  });
  private readonly permission: "allow" | "reject";
  private readonly timeoutMs: number;
  private readonly disposeGraceMs: number;

  constructor(private readonly options: AcpProviderOptions) {
    if (!options.command) throw new TypeError("ACP provider requires a command.");
    this.name = options.name ?? "acp";
    this.permission = options.permission ?? "reject";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.disposeGraceMs = options.disposeGraceMs ?? 3_000;
  }

  async start(input: SubagentStartInput & { cwd: string }, context: SubagentProviderContext): Promise<SubagentRunHandle> {
    const id = input.childId ?? randomUUID();
    const processHandle = spawnProcess(this.options.command, this.options.args ?? [], {
      cwd: input.cwd,
      env: this.options.env,
      inheritEnv: this.options.inheritEnv,
      timeoutMs: this.timeoutMs,
      shell: this.options.shell ?? process.platform === "win32",
    });
    let sessionId: string | undefined;
    let aborted = false;
    let disposed = false;
    let content = "", truncated = false;
    const result = Promise.withResolvers<SubagentResult>();
    const timer = setTimeout(() => { aborted = true; void processHandle.kill(this.disposeGraceMs); }, this.timeoutMs);
    const connection = new JsonLineConnection(processHandle, (method, params) => {
      if (method !== "session/update") return;
      const update = asRecord(asRecord(params)?.update);
      if (!update) return;
      if (update.sessionUpdate === "agent_message_chunk") {
        const chunk = asRecord(update.content);
        if (chunk?.type === "text" && typeof chunk.text === "string") {
          const room = SUBAGENT_LIMITS.resultCharacters - content.length;
          if (chunk.text.length > room) truncated = true;
          content += chunk.text.slice(0, Math.max(0, room));
          context.onEvent?.({ childId: id, provider: this.name, type: "message", message: { role: "assistant", content: chunk.text }, time: Date.now() });
        }
      } else if (update.sessionUpdate === "agent_thought_chunk") {
        // Reasoning stays out of the parent transcript.
      }
    }, async (method, params) => {
      if (method !== "session/request_permission") throw new Error(`Unsupported ACP request: ${method}`);
      const options = asRecord(params)?.options;
      const offered = Array.isArray(options) ? options.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
      if (this.permission === "reject") return { outcome: { outcome: "cancelled" } };
      const allow = offered.find(option => option.kind === "allow_once") ?? offered.find(option => option.kind === "allow_always");
      return allow && typeof allow.optionId === "string"
        ? { outcome: { outcome: "selected", optionId: allow.optionId } }
        : { outcome: { outcome: "cancelled" } };
    });
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      if (sessionId) { try { connection.notify("session/cancel", { sessionId }); } catch { /* closed */ } }
      void processHandle.kill(this.disposeGraceMs);
    };
    context.signal?.addEventListener("abort", onAbort, { once: true });
    if (context.signal?.aborted) onAbort();
    const finish = (outcome: SubagentResult): SubagentResult => {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
      connection.close();
      result.resolve(outcome);
      return outcome;
    };
    const fail = (error: unknown) => finish({
      childId: id,
      provider: this.name,
      status: aborted || disposed ? "cancelled" : "failed",
      content,
      stopReason: aborted ? "aborted" : "error",
      diagnostic: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    });
    void (async () => {
      try {
        await connection.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "ringko", version: "0.1.0" },
        }, context.signal);
        const created = asRecord(await connection.request("session/new", { cwd: input.cwd, mcpServers: [] }, context.signal));
        if (typeof created?.sessionId !== "string") throw new Error("ACP agent did not return a session id.");
        sessionId = created.sessionId;
        const outcome = await connection.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: input.prompt }],
        }, context.signal);
        const parsed = asRecord(outcome);
        const reason = stopReason(parsed?.stopReason);
        const empty = reason === "completed" && content.trim().length === 0;
        finish({
          childId: id,
          provider: this.name,
          status: reason === "completed" && !empty ? "completed" : reason === "aborted" ? "cancelled" : "failed",
          content,
          ...(truncated ? { truncated: true } : {}),
          stopReason: empty ? "error" : reason,
          ...(empty ? { diagnostic: "ACP agent returned no answer." } : reason !== "completed" && reason !== "aborted" ? { diagnostic: `ACP agent stopped: ${String(parsed?.stopReason ?? "unknown")}.` } : {}),
        });
      } catch (error) {
        fail(error);
      }
    })();
    return {
      childId: id,
      provider: this.name,
      capabilities: this.capabilities,
      result: result.promise,
      interrupt: () => {
        aborted = true;
        if (sessionId) { try { connection.notify("session/cancel", { sessionId }); } catch { /* closed */ } }
        void processHandle.kill(this.disposeGraceMs);
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        context.signal?.removeEventListener("abort", onAbort);
        connection.close();
        await processHandle.kill(this.disposeGraceMs).catch(() => undefined);
        result.resolve({ childId: id, provider: this.name, status: "cancelled", content, stopReason: "aborted" });
      },
    };
  }

  async resume(_entry: SubagentCatalogEntry, _context: SubagentProviderContext): Promise<SubagentRunHandle> {
    throw new Error("ACP subagents cannot be resumed.");
  }
}
