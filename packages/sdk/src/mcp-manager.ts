import { loadMcpServers, writeDiagnostic, type McpServerConfig } from "@ringko-ai/config";
import { closeMcpConnections, openMcpServer, type McpConnection } from "@ringko-ai/mcp";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;
const MAX_SERVERS = 64;

interface ConnectionState {
  initial?: Promise<void>;
  connections: Map<string, McpConnection>;
  failures: Map<string, number>;
  errors: Map<string, string>;
  pending: Map<string, Promise<void>>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

function newState(): ConnectionState {
  return { connections: new Map(), failures: new Map(), errors: new Map(), pending: new Map(), timers: new Map() };
}

function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const http = /^MCP HTTP (\d{3})\b/.exec(message);
  if (http) return `MCP HTTP ${http[1]}`;
  if (message.includes("Unable to connect")) return "Unable to connect. Is the computer able to access the URL?";
  if (message.includes("timed out")) return "MCP connection timed out.";
  if (message.includes("repeats its cursor") || message.includes("exceeds")) return "MCP response exceeded a supported limit.";
  return "Unable to initialize MCP server. Check its command, URL and credentials.";
}

/** Workspace-scoped MCP connections with per-server retry limits and no overlapping attempts. */
export class McpManager {
  private state = newState();
  private closed = false;

  constructor(private readonly workspace: string, private readonly retryDelayMs = RETRY_DELAY_MS) {}

  private connect(state: ConnectionState, name: string, config: McpServerConfig): Promise<void> {
    if (this.closed || state !== this.state || state.connections.has(name) || (state.failures.get(name) ?? 0) >= MAX_ATTEMPTS) return Promise.resolve();
    const active = state.pending.get(name);
    if (active) return active;
    const attempt = (async () => {
      try {
        const connection = await openMcpServer(name, config);
        if (this.closed || state !== this.state) { await connection.client.close(); return; }
        state.connections.set(name, connection);
        state.failures.delete(name);
        state.errors.delete(name);
      } catch (error) {
        if (this.closed || state !== this.state) return;
        const failures = (state.failures.get(name) ?? 0) + 1;
        state.failures.set(name, failures);
        const message = publicFailure(error);
        state.errors.set(name, `${message} (attempt ${failures}/${MAX_ATTEMPTS}${failures === MAX_ATTEMPTS ? "; automatic retry stopped" : "; retry scheduled"})`);
        writeDiagnostic(`mcp.${name}`, state.errors.get(name)!);
        if (failures < MAX_ATTEMPTS) {
          const timer = setTimeout(() => {
            state.timers.delete(name);
            void this.connect(state, name, config);
          }, this.retryDelayMs * failures);
          timer.unref?.();
          state.timers.set(name, timer);
        }
      } finally { state.pending.delete(name); }
    })();
    state.pending.set(name, attempt);
    return attempt;
  }

  private snapshot(state: ConnectionState) {
    return {
      connections: [...state.connections.values()].sort((a, b) => a.name.localeCompare(b.name)),
      errors: [...state.errors].sort(([a], [b]) => a.localeCompare(b)).map(([name, message]) => ({ name, message })),
    };
  }

  async start(): Promise<{ connections: McpConnection[]; errors: { name: string; message: string }[] }> {
    if (this.closed) throw new Error("MCP manager is closed.");
    const state = this.state;
    state.initial ??= (async () => {
      try {
        const servers = loadMcpServers({ cwd: this.workspace });
        if (servers.length > MAX_SERVERS) throw new Error("MCP configuration exceeds 64 servers.");
        await Promise.all(servers.map(server => this.connect(state, server.name, server.config)));
      } catch (error) {
        if (state !== this.state || this.closed) return;
        const message = error instanceof Error ? error.message : String(error);
        state.errors.set("configuration", message);
        writeDiagnostic("mcp.configuration", message);
      }
    })();
    await state.initial;
    return state === this.state ? this.snapshot(state) : this.start();
  }

  async reset(): Promise<void> {
    const previous = this.state;
    this.state = newState();
    for (const timer of previous.timers.values()) clearTimeout(timer);
    await previous.initial;
    await Promise.allSettled([...previous.pending.values()]);
    await closeMcpConnections([...previous.connections.values()]);
    if (!this.closed && previous.initial) await this.start();
  }

  close(): Promise<void> {
    this.closed = true;
    return this.reset();
  }
}
