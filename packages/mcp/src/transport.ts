// MCP transports: stdio, legacy HTTP+SSE, and Streamable HTTP.
import { writeDiagnostic } from "@ringko-ai/config";
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
const HTTP_TIMEOUT_MS = 30_000;

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
export function createStdioTransport(options: {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  diagnosticName?: string;
}): Transport {
  const proc = Bun.spawn([options.command, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
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
      proc.stdin.write(`${JSON.stringify(message)}\n`);
      await proc.stdin.flush();
    },
    onMessage(next) {
      handler = next;
    },
    async close() {
      try {
        proc.kill();
      } catch {
        // already gone
      }
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
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  void (async () => {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/event-stream", ...headers },
        signal: controller.signal,
      });
      if (!response.body) return;
      await readSse(
        response.body,
        (event, data) => {
          if (event === "endpoint") {
            postUrl = new URL(data.trim(), url).toString();
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
    } catch {
      // stream closed or aborted
    } finally {
      markReady();
    }
  })();

  return {
    async send(message) {
      await ready;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]);
      const response = await fetch(postUrl, {
        method: "POST",
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
