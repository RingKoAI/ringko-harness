import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { accessSync, constants, statSync } from "node:fs";
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

export type CommandParser = "text" | "claude-stream-json" | "codex-jsonl";

export interface CommandProviderOptions {
  name: string;
  kind?: string;
  description?: string;
  command: string;
  args?: readonly string[];
  resumeArgs?: readonly string[];
  promptDelivery?: "stdin" | "arg";
  parser?: CommandParser;
  model?: string;
  env?: Readonly<Record<string, string>>;
  inheritEnv?: readonly string[];
  timeoutMs?: number;
  capabilities?: Partial<SubagentProvider["capabilities"]>;
  disposeGraceMs?: number;
  /** Override shell spawning; defaults to true on Windows for .cmd shims. */
  shell?: boolean;
  available?: () => boolean | Promise<boolean>;
}

export interface ParsedOutput {
  text: string;
  sessionId?: string;
  final?: string;
  stopReason?: SubagentStopReason;
  diagnostic?: string;
}

export interface OutputParser {
  push(line: string): { text?: string; sessionId?: string } | undefined;
  finish(): ParsedOutput;
}

interface ActiveProcess {
  process: SpawnedProcess;
  aborted: boolean;
}

interface CommandChild {
  id: string;
  provider: string;
  model?: string;
  nativeSessionId?: string;
  context?: SubagentProviderContext;
  current?: ActiveProcess;
  disposed: boolean;
  running: boolean;
  settled: boolean;
  result: PromiseWithResolvers<SubagentResult>;
  last?: SubagentResult;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(block => {
    const item = asRecord(block);
    return item?.type === "text" && typeof item.text === "string" ? item.text : "";
  }).join("");
}

function claudeParser(): OutputParser {
  let text = "";
  let sessionId: string | undefined;
  let final: string | undefined;
  let stop: SubagentStopReason = "completed";
  let diagnostic: string | undefined;
  return {
    push(line) {
      let event: Record<string, unknown> | undefined;
      try { event = asRecord(JSON.parse(line)); } catch { return undefined; }
      if (!event) return undefined;
      if (typeof event.session_id === "string") sessionId = event.session_id;
      if (event.type === "assistant") {
        const chunk = textOf(asRecord(event.message)?.content);
        if (chunk) { text += chunk; return { text: chunk, ...(sessionId ? { sessionId } : {}) }; }
      }
      if (event.type === "result") {
        if (typeof event.result === "string" && event.result.trim()) final = event.result;
        const subtype = String(event.subtype ?? "");
        stop = event.is_error === true || subtype !== "success"
          ? subtype === "error_max_turns" ? "turn_limit" : "error"
          : "completed";
        if (stop !== "completed") diagnostic = `Claude Code ended with ${subtype || "an error"}.`;
      }
      return sessionId ? { text: "", sessionId } : undefined;
    },
    finish() {
      return {
        text,
        ...(sessionId ? { sessionId } : {}),
        final: final ?? text,
        stopReason: stop,
        ...(diagnostic ? { diagnostic } : {}),
      };
    },
  };
}

function codexParser(): OutputParser {
  let text = "";
  let sessionId: string | undefined;
  let final: string | undefined;
  let stop: SubagentStopReason = "completed";
  let diagnostic: string | undefined;
  return {
    push(line) {
      let event: Record<string, unknown> | undefined;
      try { event = asRecord(JSON.parse(line)); } catch { return undefined; }
      if (!event) return undefined;
      if (event.type === "thread.started" && typeof event.thread_id === "string") sessionId = event.thread_id;
      if (event.type === "item.completed") {
        const item = asRecord(event.item);
        if ((item?.type === "agent_message" || item?.type === "assistant_message") && typeof item.text === "string" && item.text.trim()) {
          final = item.text;
          text = item.text;
          return { text: item.text, ...(sessionId ? { sessionId } : {}) };
        }
      }
      if (event.type === "turn.completed") stop = "completed";
      if (event.type === "turn.failed" || event.type === "error") {
        stop = "error";
        const error = asRecord(event.error);
        diagnostic = typeof error?.message === "string" ? error.message.slice(0, 500) : "Codex turn failed.";
      }
      return sessionId ? { text: "", sessionId } : undefined;
    },
    finish() {
      return {
        text,
        ...(sessionId ? { sessionId } : {}),
        ...(final !== undefined ? { final } : text ? { final: text } : {}),
        stopReason: text.trim() ? stop : stop === "completed" ? "error" : stop,
        ...(diagnostic ? { diagnostic } : {}),
      };
    },
  };
}

function textParser(): OutputParser {
  let text = "";
  return {
    push(line) { text += `${line}\n`; return { text: line }; },
    finish() { return { text, final: text.trim() || undefined, stopReason: text.trim() ? "completed" : "error" }; },
  };
}

function parserFor(kind: CommandParser): OutputParser {
  if (kind === "claude-stream-json") return claudeParser();
  if (kind === "codex-jsonl") return codexParser();
  return textParser();
}

function expand(template: readonly string[], values: { cwd: string; model?: string; sessionId?: string; prompt?: string }): string[] {
  return template.map(part => part
    .replaceAll("{cwd}", values.cwd)
    .replaceAll("{model}", values.model ?? "")
    .replaceAll("{sessionId}", values.sessionId ?? "")
    .replaceAll("{prompt}", values.prompt ?? ""));
}

function clip(text: string): { content: string; truncated: boolean } {
  return text.length > 32_768 ? { content: text.slice(0, 32_768), truncated: true } : { content: text, truncated: false };
}

function commandAvailable(command: string): boolean {
  if (isAbsolute(command)) { try { accessSync(command, constants.X_OK); return statSync(command).isFile(); } catch { return false; } }
  const bun = (globalThis as { Bun?: { which?(name: string): string | null } }).Bun;
  if (bun?.which) return Boolean(bun.which(command));
  return false;
}

/**
 * Generic process-backed agent adapter. Claude Code, Codex and any CLI agent
 * that exposes a line protocol share the same lifecycle, timeout, resume,
 * cancellation and result handling; only argv and the parser differ.
 */
export class CommandProvider implements SubagentProvider {
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  readonly capabilities: SubagentProvider["capabilities"];
  private readonly disposeGraceMs: number;

  constructor(private readonly options: CommandProviderOptions) {
    if (typeof options.command !== "string" || options.command.length === 0) throw new TypeError("Command provider requires an executable.");
    this.name = options.name;
    this.kind = options.kind ?? "command";
    this.description = options.description ?? `Runs ${options.command} as a delegated agent.`;
    this.capabilities = Object.freeze({
      continuable: false,
      resume: false,
      modelSelection: true,
      tools: false,
      approvals: false,
      ...options.capabilities,
    });
    this.disposeGraceMs = options.disposeGraceMs ?? 2_000;
  }

  available(): boolean | Promise<boolean> {
    return this.options.available?.() ?? commandAvailable(this.options.command);
  }

  async start(input: SubagentStartInput & { cwd: string }, context: SubagentProviderContext): Promise<SubagentRunHandle> {
    const child = this.child(input.model ?? this.options.model, context, input.childId);
    void this.run(child, input.prompt, input.cwd, undefined)
      .then(result => this.settle(child, result), error => this.settle(child, this.failure(child, error)));
    return this.handle(child, input.cwd);
  }

  async resume(entry: SubagentCatalogEntry, context: SubagentProviderContext): Promise<SubagentRunHandle> {
    const native = typeof entry.metadata?.nativeSessionId === "string" ? entry.metadata.nativeSessionId : undefined;
    if (!native) throw new Error(`Subagent ${entry.childId} has no resumable provider session.`);
    const child = this.child(entry.model, context);
    child.id = entry.childId;
    child.nativeSessionId = native;
    return this.handle(child, entry.cwd || context.workspace);
  }

  private child(model: string | undefined, context: SubagentProviderContext, id?: string): CommandChild {
    return {
      id: id ?? randomUUID(),
      provider: this.name,
      ...(model ? { model } : {}),
      context,
      disposed: false,
      running: false,
      settled: false,
      result: Promise.withResolvers<SubagentResult>(),
    };
  }

  private handle(child: CommandChild, cwd: string): SubagentRunHandle {
    return {
      childId: child.id,
      provider: this.name,
      capabilities: this.capabilities,
      result: child.result.promise,
      ...(this.capabilities.continuable ? { send: (content, signal) => this.send(child, content, cwd, signal) } : {}),
      interrupt: () => this.interrupt(child),
      dispose: () => this.dispose(child),
    };
  }

  private settle(child: CommandChild, result: SubagentResult): SubagentResult {
    if (child.settled) return child.last ?? result;
    child.last = result;
    child.settled = true;
    child.result.resolve(result);
    return result;
  }

  private async send(child: CommandChild, content: string, cwd: string, signal?: AbortSignal): Promise<void> {
    if (child.disposed) throw new Error("Subagent is disposed.");
    if (child.running) throw new Error("Subagent is busy with another turn.");
    if (!this.capabilities.continuable || !child.nativeSessionId) throw new Error("Subagent cannot accept follow-up input.");
    const result = await this.run(child, content, cwd, child.nativeSessionId, signal);
    if (!child.settled) this.settle(child, result);
    if (result.status !== "completed") throw new Error(result.diagnostic ?? `Subagent ${result.status}.`);
  }

  private interrupt(child: CommandChild): void {
    if (child.current) {
      child.current.aborted = true;
      void child.current.process.kill(this.disposeGraceMs);
    }
  }

  private async dispose(child: CommandChild): Promise<void> {
    if (child.disposed) return;
    child.disposed = true;
    if (child.current) {
      child.current.aborted = true;
      await child.current.process.kill(this.disposeGraceMs);
    }
    if (!child.settled) this.settle(child, child.last ?? this.cancelled(child));
  }

  private async run(child: CommandChild, prompt: string, cwd: string, sessionId?: string, signal?: AbortSignal): Promise<SubagentResult> {
    const context = child.context;
    if (!context) throw new Error("Subagent provider context is unavailable.");
    const abortSignal = signal ?? context.signal;
    child.running = true;
    context.onEvent?.({ childId: child.id, provider: this.name, type: "status", status: "running", time: Date.now() });
    const template = sessionId === undefined ? this.options.args : this.options.resumeArgs;
    if (sessionId !== undefined && !template) {
      child.running = false;
      throw new Error(`Provider "${this.name}" has no resume command.`);
    }
    const promptDelivery = this.options.promptDelivery ?? "stdin";
    if (promptDelivery === "arg" && process.platform === "win32") {
      child.running = false;
      throw new Error("Prompt-on-argv is not supported on Windows; use stdin delivery.");
    }
    const args = expand(template ?? [], {
      cwd,
      ...(child.model ? { model: child.model } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(promptDelivery === "arg" ? { prompt } : {}),
    });
    if (promptDelivery === "arg" && !(template ?? []).some(part => part.includes("{prompt}"))) args.push(prompt);
    let processHandle: SpawnedProcess;
    try { processHandle = spawnProcess(this.options.command, args, {
      cwd,
      ...(this.options.env ? { env: { ...this.options.env } } : {}),
      ...(this.options.inheritEnv ? { inheritEnv: this.options.inheritEnv } : {}),
      ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
      shell: this.options.shell ?? (promptDelivery !== "arg" && process.platform === "win32"),
    }); } catch (error) { child.running = false; throw error; }
    const active: ActiveProcess = { process: processHandle, aborted: false };
    child.current = active;
    const parser = parserFor(this.options.parser ?? "text");
    const onAbort = () => { active.aborted = true; void processHandle.kill(this.disposeGraceMs); };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
    let outcome: SubagentResult;
    try {
      if (promptDelivery === "stdin") {
        processHandle.writeStdin(prompt);
        processHandle.closeStdin();
      }
      let pumpError: unknown;
      const pump = processHandle.lines(line => {
        const update = parser.push(line);
        if (update?.sessionId && update.sessionId !== child.nativeSessionId) {
          child.nativeSessionId = update.sessionId;
          context.onEvent?.({ childId: child.id, provider: this.name, type: "status", status: "running", metadata: { nativeSessionId: update.sessionId }, time: Date.now() });
        }
        if (update?.text) context.onEvent?.({ childId: child.id, provider: this.name, type: "message", message: { role: "assistant", content: update.text }, time: Date.now() });
      }).catch(error => { pumpError = error; });
      const exit = await processHandle.exited;
      await pump;
      if (pumpError !== undefined) throw pumpError;
      const parsed = parser.finish();
      if (parsed.sessionId && parsed.sessionId !== child.nativeSessionId) {
        child.nativeSessionId = parsed.sessionId;
        context.onEvent?.({ childId: child.id, provider: this.name, type: "status", status: "running", metadata: { nativeSessionId: child.nativeSessionId }, time: Date.now() });
      }
      const content = parsed.final ?? parsed.text;
      if (active.aborted || child.disposed || abortSignal?.aborted) {
        outcome = this.cancelled(child);
      } else if (!content.trim()) {
        outcome = {
          childId: child.id,
          provider: this.name,
          status: "failed",
          content: "",
          stopReason: parsed.stopReason ?? "error",
          diagnostic: parsed.diagnostic ?? `Provider exited with code ${String(exit.code ?? "unknown")} without an answer.`,
          ...(child.nativeSessionId ? { metadata: { nativeSessionId: child.nativeSessionId } } : {}),
        };
      } else if ((parsed.stopReason && parsed.stopReason !== "completed") || (exit.code !== null && exit.code !== 0)) {
        outcome = {
          childId: child.id,
          provider: this.name,
          status: "failed",
          content: clip(content).content,
          stopReason: parsed.stopReason && parsed.stopReason !== "completed" ? parsed.stopReason : "error",
          diagnostic: parsed.diagnostic ?? `Provider exited with code ${String(exit.code ?? "unknown")}.`,
          ...(child.nativeSessionId ? { metadata: { nativeSessionId: child.nativeSessionId } } : {}),
        };
      } else {
        const clipped = clip(content);
        outcome = {
          childId: child.id,
          provider: this.name,
          status: "completed",
          content: clipped.content,
          stopReason: "completed",
          ...(clipped.truncated ? { truncated: true } : {}),
          ...(child.nativeSessionId ? { metadata: { nativeSessionId: child.nativeSessionId } } : {}),
        };
      }
    } catch (error) {
      outcome = active.aborted || child.disposed || abortSignal?.aborted ? this.cancelled(child) : this.failure(child, error);
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
      child.running = false;
      if (child.current === active) child.current = undefined;
    }
    child.last = outcome;
    context.onEvent?.({ childId: child.id, provider: this.name, type: "status", status: outcome.status, time: Date.now(), result: outcome });
    return outcome;
  }

  private failure(child: CommandChild, error: unknown): SubagentResult {
    return {
      childId: child.id,
      provider: this.name,
      status: "failed",
      content: "",
      stopReason: "error",
      diagnostic: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      ...(child.nativeSessionId ? { metadata: { nativeSessionId: child.nativeSessionId } } : {}),
    };
  }

  private cancelled(child: CommandChild): SubagentResult {
    return {
      childId: child.id,
      provider: this.name,
      status: "cancelled",
      content: child.last?.content ?? "",
      stopReason: "aborted",
      ...(child.nativeSessionId ? { metadata: { nativeSessionId: child.nativeSessionId } } : {}),
    };
  }
}

/** Built-in Claude Code CLI profile (stream-json, native resume via --resume). */
export function claudeCodeProvider(options: {
  name?: string;
  command?: string;
  args?: readonly string[];
  model?: string;
  permissionMode?: string;
  env?: Readonly<Record<string, string>>;
  inheritEnv?: readonly string[];
  timeoutMs?: number;
} = {}): CommandProvider {
  const base = options.args ?? [
    "-p", "--output-format", "stream-json", "--verbose",
    "--permission-mode", options.permissionMode ?? "dontAsk",
    "--permission-prompts", "none",
    ...(options.model ? ["--model", options.model] : []),
  ];
  return new CommandProvider({
    name: options.name ?? "claude-code",
    kind: "claude-code",
    description: "Claude Code CLI in unattended stream-json mode, with native session resume.",
    command: options.command ?? "claude",
    args: base,
    resumeArgs: options.args ?? [...base, "--resume", "{sessionId}"],
    promptDelivery: "stdin",
    parser: "claude-stream-json",
    ...(options.model ? { model: options.model } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.inheritEnv ? { inheritEnv: options.inheritEnv } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    capabilities: { continuable: true, resume: true, modelSelection: true, tools: false, approvals: false },
  });
}

/** Built-in Codex CLI profile (JSONL exec, thread resume). */
export function codexProvider(options: {
  name?: string;
  command?: string;
  args?: readonly string[];
  resumeArgs?: readonly string[];
  model?: string;
  permissionMode?: "never" | "approve-for-me" | "dangerously-bypass-approvals-and-sandbox";
  env?: Readonly<Record<string, string>>;
  inheritEnv?: readonly string[];
  timeoutMs?: number;
} = {}): CommandProvider {
  const mode = options.permissionMode ?? "never";
  const permission = mode === "dangerously-bypass-approvals-and-sandbox"
    ? ["--dangerously-bypass-approvals-and-sandbox"]
    : mode === "approve-for-me"
      ? ["--full-auto"]
      : ["--sandbox", "workspace-write"];
  const model = options.model ? ["--model", options.model] : [];
  return new CommandProvider({
    name: options.name ?? "codex",
    kind: "codex",
    description: "Codex CLI in unattended JSONL exec mode, with thread resume.",
    command: options.command ?? "codex",
    args: options.args ?? ["exec", "--json", "--skip-git-repo-check", "--cd", "{cwd}", ...permission, ...model],
    resumeArgs: options.resumeArgs ?? ["exec", "resume", "{sessionId}", "--json", "--skip-git-repo-check", "--cd", "{cwd}", ...permission, ...model],
    promptDelivery: "stdin",
    parser: "codex-jsonl",
    ...(options.model ? { model: options.model } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.inheritEnv ? { inheritEnv: options.inheritEnv } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    capabilities: { continuable: true, resume: true, modelSelection: true, tools: false, approvals: false },
  });
}
