import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { attachFrontend, BackendClient, BackendError, PROTOCOL_VERSION, type FrontendLease, type RuntimeStatus } from "@ringko-ai/client";
import { canonicalWorkspace, sharedPort } from "@ringko-ai/client/local";
import {
  backendKey,
  DEFAULT_BACKEND_PORT,
  localBackendOrigin,
  readBackendRegistration,
  removeBackendRegistration,
} from "@ringko-ai/config";
import { IDE_LIMITS } from "./limits.ts";

export type BackendConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface BackendConnectionSettings {
  serverUrl: string;
  authToken: string;
  cliPath: string;
  autoStartBackend: boolean;
}

export interface BackendManagerStatus {
  state: BackendConnectionState;
  url: string | null;
  workspace: string;
  error: string | null;
}

export interface BackendManagerOptions {
  workspace: string;
  configPath?: string;
  extensionPath?: string;
  getSettings: () => BackendConnectionSettings;
  spawnBackend?: (port: number, workspace: string) => Promise<void> | void;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

type ProbeOutcome =
  | { status: "ok" }
  | { status: "mismatch"; message: string }
  | { status: "unreachable" };

/** Strictly validate an explicit local backend URL (loopback HTTP origin only). */
export function validateLoopbackOrigin(rawUrl: string): string {
  let target: URL;
  try {
    target = new URL(rawUrl.trim());
  } catch {
    throw new Error("Backend URL must be a valid URL such as http://127.0.0.1:8787.");
  }
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/"
  ) {
    throw new Error("Backend URL must be a local loopback HTTP origin (http://127.0.0.1:<port>).");
  }
  return target.origin;
}

function buildSpawnCandidates(cliPath: string, workspace: string, extensionPath?: string): Array<{ executable: string; prefixArgs: string[] }> {
  const trimmed = cliPath.trim() || "ringko";
  if (trimmed.includes("\0")) throw new Error("Invalid ringko.cliPath setting.");
  const candidates: Array<{ executable: string; prefixArgs: string[] }> = [
    { executable: trimmed, prefixArgs: [] },
  ];
  if (trimmed === "ringko") {
    const exeName = process.platform === "win32" ? "ringko.exe" : "ringko";
    for (const root of [workspace, ...(extensionPath ? [resolve(extensionPath, "../..")] : [])]) {
      const distBin = join(root, "dist", exeName);
      if (existsSync(distBin)) candidates.push({ executable: distBin, prefixArgs: [] });
      const cliEntry = join(root, "packages", "tui", "src", "cli.ts");
      if (existsSync(cliEntry)) candidates.push({ executable: "bun", prefixArgs: [cliEntry] });
    }
  }
  return candidates;
}

async function spawnDetachedBackend(
  candidates: ReadonlyArray<{ executable: string; prefixArgs: string[] }>,
  serviceArgs: ReadonlyArray<string>,
  workspace: string,
  onExit: () => void,
): Promise<void> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      await new Promise<void>((ready, reject) => {
        const child = spawn(candidate.executable, [...candidate.prefixArgs, ...serviceArgs], {
          cwd: workspace,
          env: process.env,
          detached: true,
          stdio: "ignore",
          shell: false,
          windowsHide: true,
        });
        child.once("exit", onExit);
        child.once("spawn", () => {
          child.unref();
          ready();
        });
        child.once("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to launch RingKo backend process. Check ringko.cliPath in settings.");
}

export class BackendManager {
  private readonly workspace: string;
  private readonly configPath: string | undefined;
  private readonly extensionPath: string | undefined;
  private readonly getSettings: () => BackendConnectionSettings;
  private readonly customSpawn: ((port: number, workspace: string) => Promise<void> | void) | undefined;
  private readonly customFetch: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;

  private state: BackendConnectionState = "disconnected";
  private activeClient: BackendClient | null = null;
  private activeUrl: string | null = null;
  private lastError: string | null = null;
  private ideLease: FrontendLease | null = null;
  private webLease: FrontendLease | null = null;
  private connecting: Promise<BackendClient> | null = null;
  private disposed = false;
  private connectionGeneration = 0;
  private readonly listeners = new Set<(status: BackendManagerStatus) => void>();

  constructor(options: BackendManagerOptions) {
    this.workspace = canonicalWorkspace(options.workspace);
    this.configPath = options.configPath ? resolve(options.configPath) : undefined;
    this.extensionPath = options.extensionPath ? resolve(options.extensionPath) : undefined;
    this.getSettings = options.getSettings;
    this.customSpawn = options.spawnBackend;
    this.customFetch = options.fetch;
  }

  getWorkspace(): string {
    return this.workspace;
  }

  getStatus(): BackendManagerStatus {
    return {
      state: this.state,
      url: this.activeUrl,
      workspace: this.workspace,
      error: this.lastError,
    };
  }

  getClient(): BackendClient | null {
    return this.state === "connected" ? this.activeClient : null;
  }

  getAuthToken(): string | undefined {
    const configured = this.getSettings().authToken.trim();
    if (configured) return configured;
    const envToken = process.env.RINGKO_WEB_TOKEN?.trim();
    return envToken || undefined;
  }

  subscribe(listener: (status: BackendManagerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(): Promise<BackendClient> {
    if (this.disposed) throw new Error("BackendManager is disposed.");
    if (this.state === "connected" && this.activeClient) return this.activeClient;
    if (this.connecting) return this.connecting;

    const task = this.establishConnection().finally(() => {
      if (this.connecting === task) this.connecting = null;
    });
    this.connecting = task;
    return task;
  }

  async reconnect(): Promise<BackendClient> {
    await this.releaseLeases();
    this.activeClient = null;
    this.activeUrl = null;
    this.updateState("disconnected", null);
    return this.connect();
  }

  /** Acquire or reuse a `"web"` lease so opening the backend URL in a browser serves WebUI pages. */
  async ensureWebUiUrl(): Promise<string> {
    const client = await this.connect();
    const url = this.activeUrl;
    if (!url) throw new Error("Backend URL is unavailable.");
    if (!this.webLease) {
      const lease = await attachFrontend(client, "web");
      this.webLease = lease;
      void lease.lost.then(() => {
        if (this.webLease === lease) this.webLease = null;
      });
    }
    return url;
  }

  async fetchRuntimeStatus(): Promise<RuntimeStatus> {
    const client = await this.connect();
    return client.request<RuntimeStatus>("/api/status", undefined, "GET", AbortSignal.timeout(IDE_LIMITS.statusTimeoutMs));
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.connectionGeneration++;
    await this.releaseLeases();
    this.activeClient = null;
    this.activeUrl = null;
    this.listeners.clear();
  }

  private createClient(url: string): BackendClient {
    return new BackendClient({
      url,
      token: () => this.getAuthToken() ?? null,
      workspace: this.workspace,
      ...(this.customFetch ? { fetch: this.customFetch } : {}),
    });
  }

  private async probe(client: BackendClient): Promise<ProbeOutcome> {
    let identity;
    try {
      identity = await client.identity(AbortSignal.timeout(IDE_LIMITS.backendProbeTimeoutMs));
    } catch (error) {
      if (error instanceof BackendError) {
        if (error.status === 503) return { status: "unreachable" };
        if (error.status === 401 || error.status === 403) {
          return { status: "mismatch", message: `Backend rejected authentication (HTTP ${error.status}). Configure ringko.authToken.` };
        }
        return { status: "mismatch", message: `Backend rejected connection (HTTP ${error.status}).` };
      }
      return { status: "unreachable" };
    }
    if (
      identity.protocol !== PROTOCOL_VERSION ||
      backendKey(identity.workspace, identity.configPath ?? undefined) !== backendKey(this.workspace, this.configPath)
    ) {
      return {
        status: "mismatch",
        message: "Target local port belongs to a different RingKo workspace or configuration.",
      };
    }
    return { status: "ok" };
  }

  private async findLive(): Promise<{ client: BackendClient; url: string } | undefined> {
    const candidates: string[] = [];
    const registration = readBackendRegistration(this.workspace, this.configPath);
    if (registration) candidates.push(registration.url);
    candidates.push(`http://127.0.0.1:${sharedPort(this.workspace, this.configPath)}`);
    candidates.push(`http://127.0.0.1:${DEFAULT_BACKEND_PORT}`);

    const seen = new Set<string>();
    const registrationUrl = registration ? localBackendOrigin(registration.url) : undefined;
    let registrationUnreachable = false;

    for (const candidate of candidates) {
      const origin = localBackendOrigin(candidate);
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      const client = this.createClient(origin);
      const result = await this.probe(client);
      if (result.status === "ok") return { client, url: origin };
      if (result.status === "mismatch" && origin === registrationUrl && result.message.includes("authentication")) {
        throw new Error(result.message);
      }
      if (registration && origin === registrationUrl && result.status === "unreachable") {
        registrationUnreachable = true;
      }
    }

    if (registration && registrationUnreachable && Date.now() - registration.startedAt >= IDE_LIMITS.staleRegistrationMs) {
      removeBackendRegistration(this.workspace, this.configPath, registration.instance);
    }
    return undefined;
  }

  private async establishConnection(): Promise<BackendClient> {
    const generation = ++this.connectionGeneration;
    this.updateState("connecting", null);

    try {
      const settings = this.getSettings();
      const explicit = settings.serverUrl.trim() || process.env.RINGKO_SERVER?.trim() || "";
      let resolved: { client: BackendClient; url: string } | undefined;

      if (explicit) {
        const origin = validateLoopbackOrigin(explicit);
        const client = this.createClient(origin);
        const result = await this.probe(client);
        if (result.status === "mismatch") throw new Error(result.message);
        if (result.status === "unreachable") {
          throw new Error(`No RingKo backend reachable at ${origin}.`);
        }
        resolved = { client, url: origin };
      } else {
        resolved = await this.findLive();
        if (!resolved) {
          if (!settings.autoStartBackend) {
            throw new Error("No shared RingKo backend is running for this workspace (autoStartBackend is disabled).");
          }
          resolved = await this.startAndConnect(settings);
        }
      }

      if (this.disposed || generation !== this.connectionGeneration) {
        throw new Error("Connection superseded.");
      }

      const lease = await attachFrontend(resolved.client, "ide");
      if (this.disposed || generation !== this.connectionGeneration) {
        await lease.close().catch(() => {});
        throw new Error("Connection superseded.");
      }

      this.ideLease = lease;
      this.activeClient = resolved.client;
      this.activeUrl = resolved.url;
      this.updateState("connected", null);

      void lease.lost.then(error => {
        if (this.ideLease !== lease || this.disposed) return;
        this.ideLease = null;
        this.webLease = null;
        this.activeClient = null;
        this.activeUrl = null;
        this.updateState("disconnected", error.message);
      });

      return resolved.client;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to connect to RingKo backend.";
      if (!this.disposed && generation === this.connectionGeneration) {
        this.activeClient = null;
        this.activeUrl = null;
        this.updateState("error", message);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async startAndConnect(settings: BackendConnectionSettings): Promise<{ client: BackendClient; url: string }> {
    const port = sharedPort(this.workspace, this.configPath);
    const serviceArgs = [
      "service",
      "serve",
      "--port",
      String(port),
      "--workspace",
      this.workspace,
      ...(this.configPath ? ["--config", this.configPath] : []),
    ];
    const candidates = buildSpawnCandidates(settings.cliPath, this.workspace, this.extensionPath);

    let attempts = 0;
    let lastStart = 0;
    let workerExited = false;

    const launch = async (): Promise<void> => {
      attempts += 1;
      lastStart = Date.now();
      workerExited = false;
      if (this.customSpawn) {
        await this.customSpawn(port, this.workspace);
        workerExited = true;
        return;
      }
      await spawnDetachedBackend(candidates, serviceArgs, this.workspace, () => {
        workerExited = true;
      });
    };

    await launch();
    const deadline = Date.now() + IDE_LIMITS.backendStartTimeoutMs;
    while (Date.now() < deadline && !this.disposed) {
      await new Promise(resolveWait => setTimeout(resolveWait, IDE_LIMITS.backendRetryMs));
      const live = await this.findLive();
      if (live) return live;
      if (
        workerExited &&
        attempts < IDE_LIMITS.backendMaxStartAttempts &&
        Date.now() - lastStart >= IDE_LIMITS.backendStartRetryMs &&
        !readBackendRegistration(this.workspace, this.configPath)
      ) {
        await launch();
      }
    }
    throw new Error(`Timed out starting RingKo backend on 127.0.0.1:${port}. Verify ringko.cliPath or run "ringko service serve".`);
  }

  private async releaseLeases(): Promise<void> {
    const leases = [this.webLease, this.ideLease].filter((item): item is FrontendLease => item !== null);
    this.webLease = null;
    this.ideLease = null;
    await Promise.all(leases.map(lease => lease.close().catch(() => {})));
  }

  private updateState(state: BackendConnectionState, error: string | null): void {
    this.state = state;
    this.lastError = error;
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate UI observer errors from transport lifecycle.
      }
    }
  }
}
