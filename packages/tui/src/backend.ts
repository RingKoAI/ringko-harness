import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { BackendClient, BackendError, PROTOCOL_VERSION } from "@ringko-ai/client";
import { canonicalWorkspace, sharedPort } from "@ringko-ai/client/local";
export { sharedPort } from "@ringko-ai/client/local";

const START_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 1_000;
const RETRY_MS = 200;
export interface ConnectOptions { workspace: string; configPath?: string; url?: string; start?: (port: number) => void; startIfMissing?: boolean }

/** A workspace/config pair has a stable rendezvous port. Binding is the atomic ownership operation. */
export async function connectBackend(options: ConnectOptions): Promise<{ client: BackendClient; url: string; workspace: string }> {
  const workspace = canonicalWorkspace(options.workspace);
  const configPath = options.configPath ? resolve(options.configPath) : undefined;
  const token = process.env.RINGKO_WEB_TOKEN?.trim();
  const explicit = options.url ?? process.env.RINGKO_SERVER;
  const port = sharedPort(workspace, configPath);
  const url = explicit ?? `http://127.0.0.1:${port}`;
  const target = new URL(url);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
    throw new Error("Backend URL must be a local HTTP origin (remote connections are not enabled).");
  }
  const normalizedUrl = target.origin;
  const client = new BackendClient({ url: normalizedUrl, token, workspace });
  const probe = async (): Promise<boolean> => {
    let identity;
    try { identity = await client.identity(AbortSignal.timeout(PROBE_TIMEOUT_MS)); }
    catch (error) {
      if (error instanceof BackendError) throw error;
      return false;
    }
    if (identity.protocol !== PROTOCOL_VERSION || resolve(identity.workspace) !== workspace || (identity.configPath ?? undefined) !== configPath) {
      throw new Error("This port belongs to a different backend/workspace/configuration. Use --server with the correct local backend address.");
    }
    return true;
  };
  if (await probe()) return { client, url: normalizedUrl, workspace };
  if (options.startIfMissing === false) throw new Error(`No backend running at ${normalizedUrl}.`);
  if (explicit) throw new Error(`Backend unavailable at ${normalizedUrl}. Start it before connecting.`);
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
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, RETRY_MS));
    if (await probe()) return { client, url: normalizedUrl, workspace };
  }
  throw new Error(`Shared backend did not start at ${normalizedUrl}. Run ringko serve --port ${port} --workspace "${workspace}" --shared to inspect the error.`);
}
