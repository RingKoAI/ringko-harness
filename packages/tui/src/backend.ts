import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { BackendClient, BackendError, PROTOCOL_VERSION } from "@ringko-ai/client";
import { canonicalWorkspace, sharedPort } from "@ringko-ai/client/local";
import { backendKey, DEFAULT_BACKEND_PORT, localBackendOrigin, readBackendRegistration } from "@ringko-ai/config";
import { cliCommand } from "./cli-identity.ts";
export { sharedPort } from "@ringko-ai/client/local";

const START_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 1_000;
const RETRY_MS = 200;
export interface ConnectOptions { workspace: string; configPath?: string; url?: string; start?: (port: number) => void; startIfMissing?: boolean }
export interface LiveBackend { client: BackendClient; url: string; workspace: string }

type Probe = { status: "ok" } | { status: "mismatch"; message: string } | { status: "unreachable" };

function validateExplicit(url: string): string {
  const target = new URL(url);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
    throw new Error("Backend URL must be a local HTTP origin (remote connections are not enabled).");
  }
  return target.origin;
}

/** Verify that a reachable local backend is the exact workspace/config instance. */
async function probe(client: BackendClient, workspace: string, configPath: string | undefined): Promise<Probe> {
  let identity;
  try {
    identity = await client.identity(AbortSignal.timeout(PROBE_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof BackendError) {
      return { status: "mismatch", message: `Backend rejected the connection (HTTP ${error.status}).` };
    }
    return { status: "unreachable" };
  }
  if (identity.protocol !== PROTOCOL_VERSION || backendKey(identity.workspace, identity.configPath ?? undefined) !== backendKey(workspace, configPath)) {
    return { status: "mismatch", message: "This port belongs to a different backend/workspace/configuration. Use --server with the correct local backend address." };
  }
  return { status: "ok" };
}

function clientFor(url: string, workspace: string): BackendClient {
  return new BackendClient({ url, token: process.env.RINGKO_WEB_TOKEN?.trim(), workspace });
}

/**
 * Find the one live backend for this workspace/config. Directory registrations
 * are authoritative; the rendezvous port and the legacy 8787 port remain
 * fallbacks for backends started before registration existed.
 */
export async function findLiveBackend(options: Pick<ConnectOptions, "workspace" | "configPath">): Promise<LiveBackend | undefined> {
  const workspace = canonicalWorkspace(options.workspace);
  const configPath = options.configPath ? resolve(options.configPath) : undefined;
  const candidates: string[] = [];
  const registration = readBackendRegistration(workspace, configPath);
  if (registration) candidates.push(registration.url);
  candidates.push(`http://127.0.0.1:${sharedPort(workspace, configPath)}`);
  candidates.push(`http://127.0.0.1:${DEFAULT_BACKEND_PORT}`);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const url = localBackendOrigin(candidate);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const client = clientFor(url, workspace);
    const result = await probe(client, workspace, configPath);
    if (result.status === "ok") return { client, url, workspace };
  }
  return undefined;
}

/** Connect to the workspace backend, starting it only when no live owner exists. */
export async function connectBackend(options: ConnectOptions): Promise<LiveBackend> {
  const workspace = canonicalWorkspace(options.workspace);
  const configPath = options.configPath ? resolve(options.configPath) : undefined;
  const explicit = options.url ?? process.env.RINGKO_SERVER;
  if (explicit) {
    const url = validateExplicit(explicit);
    const client = clientFor(url, workspace);
    const result = await probe(client, workspace, configPath);
    if (result.status === "ok") return { client, url, workspace };
    if (result.status === "mismatch") throw new Error(result.message);
    throw new Error(`Backend unavailable at ${url}. Start it before connecting.`);
  }

  const live = await findLiveBackend({ workspace, configPath });
  if (live) return live;
  if (options.startIfMissing === false) throw new Error(`No backend running at ${workspace}.`);
  const port = sharedPort(workspace, configPath);
  if (options.start) options.start(port);
  else {
    const executable = process.execPath;
    const script = process.argv[1];
    const compiled = script?.includes("$bunfs") || script?.includes("~BUN") || script === executable;
    const args = [...(!compiled && script ? [resolve(script)] : []), "serve", "--shared", "--port", String(port), "--workspace", workspace, ...(configPath ? ["--config", configPath] : [])];
    const child = spawn(executable, args, { cwd: workspace, env: process.env, detached: true, stdio: "ignore", windowsHide: true });
    const spawned = new Promise<void>((ready, reject) => { child.once("spawn", ready); child.once("error", reject); });
    child.unref();
    await spawned;
  }
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, RETRY_MS));
    const client = clientFor(url, workspace);
    if ((await probe(client, workspace, configPath)).status === "ok") return { client, url, workspace };
  }
  throw new Error(`Shared backend did not start at ${url}. Run ${cliCommand()} serve --port ${port} --workspace "${workspace}" --shared to inspect the error.`);
}
