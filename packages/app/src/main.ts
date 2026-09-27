import { applyProxyEnv } from "@ringko-ai/config";
import { startServer } from "./server.ts";

applyProxyEnv();

const args = process.argv.slice(2);
const portArg = args.find((arg) => /^\d+$/.test(arg));
const dev = args.includes("--dev") || process.env.RINGKO_DEV === "1";
const devServerUrl = process.env.RINGKO_DEV_SERVER ?? "http://localhost:5173";

const authToken = process.env.RINGKO_WEB_TOKEN?.trim();

const server = startServer({
  workspace: process.cwd(),
  ...(portArg ? { port: Number(portArg) } : {}),
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
