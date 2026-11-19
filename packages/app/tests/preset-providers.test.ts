import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authPath, getKeyCredential, providerPath, saveConfig } from "@ringko-ai/config";
import { startServer, type RingkoServer } from "../src/server.ts";

let server: RingkoServer | undefined;
let root: string | undefined;
let prevHome: string | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (root) {
    if (prevHome === undefined) delete process.env.RINGKO_HOME;
    else process.env.RINGKO_HOME = prevHome;
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
});

it("serves the 15 built-in presets, stores structured keys in auth.json, toggles enabled state, and persists favoriteModels", async () => {
  root = mkdtempSync(join(tmpdir(), "rkh-preset-providers-"));
  prevHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  saveConfig({ providers: [], updates: { checkOnStartup: false } });

  server = startServer({ workspace: root, port: 0, authToken: "tok" });
  const req = (path: string, body?: unknown, method = body ? "POST" : "GET") =>
    fetch(`${server!.url}${path}`, {
      method,
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // 1. Exact 15 built-in presets
  const presetsRes = await (await req("/api/presets")).json() as { presets: Array<{ id: string }> };
  expect(presetsRes.presets.length).toBe(15);

  // 2. Save a built-in provider with multi-key input -> stored in auth.json with type="key", providerName, providerType; never in provider.json
  const saveRes = await req(
    "/api/providers",
    {
      model: "deepseek/deepseek-chat",
      providers: [
        {
          name: "deepseek",
          presetId: "deepseek",
          enabled: true,
          type: "openai-compatible",
          baseURL: "https://api.deepseek.com/v1",
          apiKey: "sk-secret-1, sk-secret-2",
          models: [
            { id: "deepseek-chat", name: "DeepSeek V3" },
            { id: "deepseek-reasoner", name: "DeepSeek R1" },
          ],
        },
      ],
    },
    "PUT",
  );
  expect(saveRes.status).toBe(200);

  const providerDiskText = readFileSync(providerPath(), "utf8");
  expect(providerDiskText).not.toContain("sk-secret-1");
  expect(providerDiskText).not.toContain("sk-secret-2");

  const authDisk = JSON.parse(readFileSync(authPath(), "utf8")) as {
    apikeys: Record<string, { type: string; providerName: string; providerType: string; key: string; keys: string[] }>;
  };
  expect(authDisk.apikeys.deepseek).toEqual({
    type: "key",
    providerName: "deepseek",
    providerType: "openai-compatible",
    key: "sk-secret-1",
    keys: ["sk-secret-1", "sk-secret-2"],
  });

  // 3. GET /api/providers redacts raw key and reports credential metadata
  const loaded = await (await req("/api/providers")).json() as {
    providers: Array<{ name: string; apiKey?: string }>;
    credentials: Record<string, { source: string; keyCount: number; configured: boolean }>;
  };
  expect(loaded.providers[0]?.apiKey).toBeUndefined();
  expect(loaded.credentials.deepseek).toMatchObject({
    configured: true,
    source: "auth",
    keyCount: 2,
  });

  // 4. Favorite models persistence via /api/ui
  const uiRes = await (await req("/api/ui", { favoriteModels: ["deepseek/deepseek-reasoner", "deepseek/deepseek-reasoner"] })).json() as {
    favoriteModels: string[];
  };
  expect(uiRes.favoriteModels).toEqual(["deepseek/deepseek-reasoner"]);

  // 5. Disable provider -> hidden from /api/info while keeping auth.json intact
  const disabledInfo = await (
    await req(
      "/api/providers",
      {
        model: "",
        providers: [
          {
            name: "deepseek",
            presetId: "deepseek",
            enabled: false,
            type: "openai-compatible",
            baseURL: "https://api.deepseek.com/v1",
            models: [{ id: "deepseek-chat", name: "DeepSeek V3" }],
          },
        ],
      },
      "PUT",
    )
  ).json() as { providers: unknown[] };
  expect(disabledInfo.providers.length).toBe(0);
  expect(getKeyCredential("deepseek")?.keys).toEqual(["sk-secret-1", "sk-secret-2"]);

  // 6. Reset / remove provider with removedProviders -> cleans up auth.json key
  await req("/api/providers", { model: "", providers: [], removedProviders: ["deepseek"] }, "PUT");
  expect(getKeyCredential("deepseek")).toBeUndefined();
});
