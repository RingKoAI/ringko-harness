// MCP transports: stdio, legacy HTTP+SSE, and Streamable HTTP.
import { writeDiagnostic } from "@ringko-ai/config";
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
const HTTP_TIMEOUT_MS = 30_000;
const STDIO_SHUTDOWN_GRACE_MS = 1_000;

async function boundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > MAX_RPC_RESPONSE_BYTES) throw new Error("MCP response exceeds 1 MiB.");
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks, size));
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface Transport {
  send(message: JsonRpcMessage): Promise<void>;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  onClose?(handler: (error: Error) => void): void;
  close(): Promise<void>;
}

/** A minimal SSE reader: parses `event:`/`data:` frames from a byte stream. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data = "";
  let complete = false;
  const flush = (): void => {
    if (data.length > 0 || event.length > 0) onFrame(event, data);
    event = "";
    data = "";
  };
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_RPC_RESPONSE_BYTES) throw new Error("MCP event exceeds 1 MiB.");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line.length === 0) flush();
        else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += (data.length > 0 ? "\n" : "") + line.slice(5).trim();
        if (data.length > MAX_RPC_RESPONSE_BYTES) throw new Error("MCP event exceeds 1 MiB.");
        index = buffer.indexOf("\n");
      }
    }
    flush();
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** stdio transport: newline-delimited JSON-RPC over a child process. */
export type ProcessWrapper = (executable: string, args: readonly string[], cwd: string, environment?: Record<string, string>) => { executable: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv };
export function createStdioTransport(options: {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  diagnosticName?: string;
  wrap?: ProcessWrapper;
}): Transport {
  const invocation = options.wrap?.(options.command, options.args ?? [], options.cwd ?? process.cwd(), options.env) ?? { executable: options.command, args: options.args ?? [], cwd: options.cwd ?? process.cwd(), env: { ...process.env, ...options.env } };
  const proc = Bun.spawn([invocation.executable, ...invocation.args], {
    cwd: invocation.cwd,
    env: invocation.env ?? { ...process.env, ...options.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });
  const stderrReader = proc.stderr.getReader();
  const stderrTask = (async () => {
    const reader = stderrReader;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        writeDiagnostic(`mcp.${options.diagnosticName ?? "stdio"}`, decoder.decode(value, { stream: true }));
      }
      const tail = decoder.decode();
      if (tail) writeDiagnostic(`mcp.${options.diagnosticName ?? "stdio"}`, tail);
    } catch (error) {
      writeDiagnostic("mcp.stderr", error instanceof Error ? error.message : String(error));
    } finally { reader.releaseLock(); }
  })();
  let handler: ((message: JsonRpcMessage) => void) | undefined;
  let closeHandler: ((error: Error) => void) | undefined;
  let exitError: Error | undefined;
  void proc.exited.then(async code => {
    await stdoutTask;
    exitError = new Error(`MCP stdio process exited (${code}).`);
    closeHandler?.(exitError);
  });
  const stdoutReader = proc.stdout.getReader();
  const stdoutTask = (async () => {
    const reader = stdoutReader;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > MAX_RPC_RESPONSE_BYTES) throw new Error("MCP stdout exceeds 1 MiB without a complete frame.");
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line.length > 0 && handler) {
            try { handler(JSON.parse(line) as JsonRpcMessage); }
            catch { /* Ignore malformed stdout frames. */ }
          }
          index = buffer.indexOf("\n");
        }
      }
    } catch (error) {
      writeDiagnostic("mcp.stdout", error instanceof Error ? error.message : String(error));
      proc.kill();
    } finally { reader.releaseLock(); }
  })();

  return {
    async send(message) {
      if (exitError) throw exitError;
      proc.stdin.write(`${JSON.stringify(message)}\n`);
      await proc.stdin.flush();
    },
    onMessage(next) {
      handler = next;
    },
    onClose(next) {
      closeHandler = next;
      if (exitError) next(exitError);
    },
    async close() {
      const stop = (signal: "SIGTERM" | "SIGKILL") => {
        if (process.platform !== "win32") {
          try { process.kill(-proc.pid, signal); return; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") writeDiagnostic("mcp.stop", "Could not signal the MCP process group."); }
        }
        try { proc.kill(signal); } catch { /* already gone */ }
      };
      stop("SIGTERM");
      const force = setTimeout(() => stop("SIGKILL"), STDIO_SHUTDOWN_GRACE_MS);
      force.unref?.();
      try { await proc.exited; }
      finally { clearTimeout(force); if (process.platform !== "win32") stop("SIGKILL"); }
      await stderrReader.cancel().catch(() => {});
      await stdoutReader.cancel().catch(() => {});
      await Promise.all([stderrTask, stdoutTask]);
    },
  };
}

/** Legacy HTTP+SSE transport: GET the SSE stream, POST to the advertised endpoint. */
export function createSseTransport(url: string, headers: Record<string, string> = {}): Transport {
  let handler: ((message: JsonRpcMessage) => void) | undefined;
  const controller = new AbortController();
  let postUrl = url;
  let connectionError: Error | undefined;
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  void (async () => {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/event-stream", ...headers },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.body) return;
      await readSse(
        response.body,
        (event, data) => {
          if (event === "endpoint") {
            const endpoint = new URL(data.trim(), url);
            if (endpoint.origin !== new URL(url).origin || endpoint.username || endpoint.password || endpoint.hash) {
              throw new Error("MCP SSE endpoint must remain on the authorized origin.");
            }
            postUrl = endpoint.toString();
            markReady();
            return;
          }
          if (data.length > 0 && handler) {
            try {
              handler(JSON.parse(data) as JsonRpcMessage);
            } catch {
              // ignore malformed frames
            }
          }
        },
        controller.signal,
      );
    } catch (error) {
      connectionError = error instanceof Error ? error : new Error("MCP SSE connection failed.");
    } finally {
      markReady();
    }
  })();

  return {
    async send(message) {
      await ready;
      if (connectionError) throw connectionError;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]);
      const response = await fetch(postUrl, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { "content-type": "application/json", accept: "application/json", ...headers },
        body: JSON.stringify(message),
      });
      if (!response.ok) throw new Error(`MCP SSE POST failed: ${response.status}`);
    },
    onMessage(next) {
      handler = next;
    },
    async close() {
      controller.abort();
    },
  };
}

/** Streamable HTTP transport: POST JSON-RPC; JSON or SSE responses. */
export function createHttpTransport(url: string, headers: Record<string, string> = {}): Transport {
  let handler: ((message: JsonRpcMessage) => void) | undefined;
  let sessionId: string | undefined;

  const dispatch = (raw: string): void => {
    if (!handler) return;
    try {
      handler(JSON.parse(raw) as JsonRpcMessage);
    } catch {
      // ignore malformed payloads
    }
  };

  return {
    async send(message) {
      const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
          ...headers,
        },
        body: JSON.stringify(message),
      });
      const sid = response.headers.get("mcp-session-id");
      if (sid) sessionId = sid;
      if (response.status === 202 || response.status === 204) return;
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`MCP HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && response.body) {
        await readSse(response.body, (_event, data) => {
          if (data.length > 0) dispatch(data);
        }, signal);
        return;
      }
      dispatch(await boundedResponse(response));
    },
    onMessage(next) {
      handler = next;
    },
    async close() {
      // stateless
    },
  };
}

