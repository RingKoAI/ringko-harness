import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  getApiKey,
  getApiKeys,
  getKeyCredential,
  getOAuthAccount,
  loadAuth,
  removeOAuthAccount,
  setApiKey,
  setDefaultOAuthAccount,
  setOAuthAccount,
  type OAuthCredential,
} from "../src/auth.ts";
import { selectModel } from "../src/config.ts";
import { parseApiKeysInput, resetKeyRoulette, selectNextApiKey } from "../src/key-roulette.ts";
import { authPath } from "../src/paths.ts";
import { BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_PRESETS } from "../src/presets.ts";
import { resolveProviderApiKey } from "../src/provider-connect.ts";
import { configuredModelIds } from "../src/task-models.ts";

let home: string;
let env: NodeJS.ProcessEnv;

function oauth(accountId: string): OAuthCredential {
  return { type: "oauth", refresh: "r", access: "a", expires: 1, accountId, login: `${accountId}@example.com` };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-auth-"));
  env = { RINGKO_HOME: home } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("auth store", () => {
  it("stores and reads an api key", () => {
    setApiKey("gateway", "secret", env);
    expect(getApiKey("gateway", env)).toBe("secret");
    expect(loadAuth(env).apikeys.gateway).toBe("secret");
    expect(getApiKey("openai-oauth", env)).toBeUndefined();
  });

  it("adds an oauth account with identity and makes it the default", () => {
    setOAuthAccount("openai-oauth", { id: "acc", credential: oauth("acc"), authenticatedAt: 5 }, env);
    const account = getOAuthAccount("openai-oauth", undefined, env);
    expect(account?.id).toBe("acc");
    expect(account?.credential.login).toBe("acc@example.com");
    expect(loadAuth(env).oauth["openai-oauth"].defaultAccountId).toBe("acc");
  });

  it("keeps multiple accounts, switches the default, and drops empty domains", () => {
    setOAuthAccount("github-copilot", { id: "a", credential: oauth("a"), authenticatedAt: 1 }, env);
    setOAuthAccount("github-copilot", { id: "b", credential: oauth("b"), authenticatedAt: 2 }, env);
    expect(getOAuthAccount("github-copilot", undefined, env)?.id).toBe("a");
    setDefaultOAuthAccount("github-copilot", "b", env);
    expect(getOAuthAccount("github-copilot", undefined, env)?.id).toBe("b");
    removeOAuthAccount("github-copilot", "b", env);
    expect(getOAuthAccount("github-copilot", undefined, env)?.id).toBe("a");
    removeOAuthAccount("github-copilot", "a", env);
    expect(loadAuth(env).oauth["github-copilot"]).toBeUndefined();
  });

  it("assigns a stable uuid and switches accounts by it", () => {
    setOAuthAccount("github-copilot", { id: "a", credential: oauth("a"), authenticatedAt: 1 }, env);
    setOAuthAccount("github-copilot", { id: "b", credential: oauth("b"), authenticatedAt: 2 }, env);
    const b = getOAuthAccount("github-copilot", "b", env);
    expect(typeof b?.uuid).toBe("string");
    setDefaultOAuthAccount("github-copilot", b?.uuid ?? "", env);
    expect(getOAuthAccount("github-copilot", undefined, env)?.id).toBe("b");
    const uuid = b?.uuid;
    // Re-signing in the same provider account keeps its uuid.
    setOAuthAccount("github-copilot", { id: "b", credential: oauth("b"), authenticatedAt: 3 }, env);
    expect(getOAuthAccount("github-copilot", "b", env)?.uuid).toBe(uuid);
  });

  it("migrates the legacy credential shape", () => {
    const path = authPath(env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        openai: { type: "oauth", refresh: "r", access: "a", expires: 1, accountId: "acc" },
        "github-copilot": { type: "oauth", refresh: "r", access: "a", expires: 1, accountId: "gh" },
        gateway: { type: "apikey", key: "k" },
      }),
    );
    expect(getApiKey("gateway", env)).toBe("k");
    expect(getOAuthAccount("openai-oauth", undefined, env)?.id).toBe("acc");
    expect(getOAuthAccount("github-copilot", undefined, env)?.id).toBe("gh");
  });

  it("returns empty for a missing file", () => {
    expect(loadAuth(env)).toEqual({ oauth: {}, apikeys: {} });
    expect(getApiKey("nope", env)).toBeUndefined();
  });

  it("persists structured type='oauth' and type='key' with providerName, providerType, and multi-key rotation", () => {
    resetKeyRoulette();
    setOAuthAccount("openai-oauth", { id: "acc-1", credential: oauth("acc-1"), authenticatedAt: 10 }, env);
    setApiKey("deepseek", "sk-one, sk-two\nsk-three", env, {
      providerName: "deepseek",
      providerType: "openai-compatible",
    });

    const rawDisk = JSON.parse(readFileSync(authPath(env), "utf8")) as {
      oauth: Record<string, { type: string }>;
      apikeys: Record<string, { type: string; providerName: string; providerType: string; key: string; keys: string[] }>;
    };
    expect(rawDisk.oauth["openai-oauth"]?.type).toBe("oauth");
    expect(rawDisk.apikeys.deepseek).toEqual({
      type: "key",
      providerName: "deepseek",
      providerType: "openai-compatible",
      key: "sk-one",
      keys: ["sk-one", "sk-two", "sk-three"],
    });

    expect(getKeyCredential("deepseek", env)?.providerType).toBe("openai-compatible");
    expect(getApiKeys("deepseek", env)).toEqual(["sk-one", "sk-two", "sk-three"]);

    const providerDef = { name: "deepseek", presetId: "deepseek", type: "openai-compatible" };
    expect(resolveProviderApiKey(providerDef, env)).toBe("sk-one");
    expect(resolveProviderApiKey(providerDef, env)).toBe("sk-two");
    expect(resolveProviderApiKey(providerDef, env)).toBe("sk-three");
    expect(resolveProviderApiKey(providerDef, env)).toBe("sk-one");
  });

  it("validates multi-key inputs, exposes exact 15 built-in presets, and skips disabled providers", () => {
    expect(BUILTIN_PROVIDER_IDS.length).toBe(15);
    expect(BUILTIN_PROVIDER_PRESETS.length).toBe(15);
    for (const preset of BUILTIN_PROVIDER_PRESETS) {
      expect(preset.builtin).toBe(true);
      expect((preset.defaultModels?.length ?? 0) > 0).toBe(true);
    }

    expect(parseApiKeysInput(" k1, k2\nk1 ")).toEqual(["k1", "k2"]);
    expect(() => parseApiKeysInput("bad key with spaces")).toThrow("ASCII");
    expect(selectNextApiKey("single", ["only"])).toBe("only");

    const cfg = {
      model: "disabled-p/m1",
      providers: [
        { name: "disabled-p", enabled: false, models: [{ id: "m1", name: "M1" }] },
        { name: "active-p", enabled: true, models: [{ id: "m2", name: "M2" }] },
      ],
    };
    expect(selectModel(cfg)?.provider.name).toBe("active-p");
    expect(configuredModelIds(cfg)).toEqual(["active-p/m2"]);
  });
});
