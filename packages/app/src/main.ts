import { applyProxyEnv } from "@ringko-ai/config";
import { startServer } from "./server.ts";
import { canonicalWorkspace, sharedPort } from "@ringko-ai/client/local";

applyProxyEnv();

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const portArg = args.find((arg) => /^\d+$/.test(arg));
const dev = args.includes("--dev") || process.env.RINGKO_DEV === "1";
const devServerUrl = process.env.RINGKO_DEV_SERVER ?? "http://localhost:5173";

const authToken = process.env.RINGKO_WEB_TOKEN?.trim();
const workspace = canonicalWorkspace(option("--workspace") ?? process.cwd());
const configPath = option("--config");
const shared = args.includes("--shared");

const server = startServer({
  workspace,
  shared,
  ...(configPath ? { configPath } : {}),
  ...(portArg ? { port: Number(portArg) } : shared ? { port: sharedPort(workspace, configPath) } : {}),
  ...(dev ? { devServerUrl } : {}),
  ...(authToken ? { authToken } : {}),
});

process.stdout.write(`RingKo WebUI (${dev ? `dev -> ${devServerUrl}` : "static"}): ${server.url}\n`);

const shutdown = (): void => {
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
