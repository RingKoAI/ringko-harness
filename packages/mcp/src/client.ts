// MCP client: initialize, list tools, call tools over a chosen transport.
import { getToolAuth, type McpServerConfig } from "@ringko-ai/config";
import { ensureToolAuth } from "./oauth.ts";
import {
  createHttpTransport,
  createSseTransport,
  createStdioTransport,
  type JsonRpcMessage,
  type Transport,
} from "./transport.ts";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerTools {
  name: string;
  serverInfo: Record<string, unknown>;
  tools: McpTool[];
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOOL_PAGES = 32;
const MAX_SERVER_TOOLS = 512;
const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "ringko", version: "0.1.0" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private serverInfo: Record<string, unknown> = {};

  constructor(readonly name: string, private readonly transport: Transport) {
    transport.onMessage((message) => this.handle(message));
  }

  private handle(message: JsonRpcMessage): void {
    if (message.id === undefined) return; // server notification: ignored
    const key = String(message.id);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = String(this.nextId++);
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out.`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      void this.transport.send(message).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  notify(method: string, params?: unknown): void {
    const message: JsonRpcMessage = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
    void this.transport.send(message).catch(() => {});
  }

  async initialize(): Promise<void> {
    const result = (await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: CLIENT_INFO,
    })) as { serverInfo?: Record<string, unknown> } | undefined;
    this.serverInfo = result?.serverInfo ?? {};
    this.notify("notifications/initialized");
  }

  get info(): Record<string, unknown> {
    return this.serverInfo;
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    let pages = 0;
    do {
      if (++pages > MAX_TOOL_PAGES) throw new Error("MCP tool listing exceeds 32 pages.");
      const result = (await this.request("tools/list", cursor === undefined ? {} : { cursor })) as
        | { tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }>; nextCursor?: unknown }
        | undefined;
      for (const tool of result?.tools ?? []) {
        if (tools.length >= MAX_SERVER_TOOLS) throw new Error("MCP server exposes more than 512 tools.");
        if (typeof tool.name !== "string" || tool.name.length === 0) continue;
        const schema =
          isRecord(tool.inputSchema) && tool.inputSchema.type === "object"
            ? tool.inputSchema
            : { type: "object", properties: {} };
        tools.push({
          name: tool.name,
          ...(typeof tool.description === "string" ? { description: tool.description } : {}),
          inputSchema: schema,
        });
      }
      cursor = typeof result?.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : undefined;
      if (cursor) { if (seen.has(cursor)) throw new Error("MCP tool listing repeats its cursor."); seen.add(cursor); }
    } while (cursor !== undefined);
    return tools;
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const result = (await this.request("tools/call", { name, arguments: args ?? {} })) as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined;
    const text = (result?.content ?? [])
      .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : JSON.stringify(item)))
      .join("\n");
    if (result?.isError) throw new Error(text.length > 0 ? text : "MCP tool reported an error.");
    return text;
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

/** Headers from `tool.auth.json` for a tool/connector id. */
function storedHeaders(name: string): Record<string, string> {
  const info = getToolAuth(name);
  if (!info) return {};
  if (info.type === "apikey") return { authorization: `Bearer ${info.key}` };
  if (info.type === "oauth") return { authorization: `Bearer ${info.access}` };
  if (info.type === "headers") return info.headers;
  return {};
}

/** Build the transport named by a server config (stdio, SSE, or Streamable HTTP). */
export function createTransport(name: string, config: McpServerConfig): Transport {
  const headers = { ...storedHeaders(name), ...stringMap(config.headers) };
  if (typeof config.command === "string" && config.command.trim().length > 0) {
    return createStdioTransport({
      diagnosticName: name,
      command: config.command,
      args: Array.isArray(config.args) ? config.args.map((arg) => String(arg)) : [],
      env: stringMap(config.env),
      ...(typeof config.cwd === "string" ? { cwd: config.cwd } : {}),
    });
  }
  if (typeof config.url === "string" && config.url.trim().length > 0) {
    return (config.type ?? "").toLowerCase() === "sse"
      ? createSseTransport(config.url, headers)
      : createHttpTransport(config.url, headers);
  }
  throw new Error(`MCP server "${name}" needs a "command" (stdio) or "url" (http/sse).`);
}

/** A live connection: the client stays open so its tools remain callable. */
export interface McpConnection {
  name: string;
  serverInfo: Record<string, unknown>;
  tools: McpTool[];
  client: McpClient;
}

/** Connect to one configured server, keep it open, and list its tools. */
export async function openMcpServer(name: string, config: McpServerConfig): Promise<McpConnection> {
  // Refresh a stored OAuth token before connecting (remote servers).
  await ensureToolAuth(name).catch(() => undefined);
  const client = new McpClient(name, createTransport(name, config));
  try {
    await client.initialize();
    const tools = await client.listTools();
    return { name, serverInfo: client.info, tools, client };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

/** Connect a whole config map, skipping (but reporting) servers that fail. */
export async function openMcpServers(
  servers: Record<string, McpServerConfig>,
): Promise<{ connections: McpConnection[]; errors: { name: string; message: string }[] }> {
  const connections: McpConnection[] = [];
  const errors: { name: string; message: string }[] = [];
  await Promise.all(
    Object.entries(servers).map(async ([name, config]) => {
      try {
        connections.push(await openMcpServer(name, config));
      } catch (error) {
        errors.push({ name, message: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
  // Deterministic order keeps the model-facing tool catalog stable (cache hits).
  connections.sort((a, b) => a.name.localeCompare(b.name));
  return { connections, errors };
}

/** Close every live connection. */
export async function closeMcpConnections(connections: readonly McpConnection[]): Promise<void> {
  await Promise.all(connections.map((connection) => connection.client.close().catch(() => {})));
}
