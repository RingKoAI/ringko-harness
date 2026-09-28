import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  getApiKey,
  getOAuthAccount,
  loadAuth,
  removeOAuthAccount,
  setApiKey,
  setDefaultOAuthAccount,
  setOAuthAccount,
  type OAuthCredential,
} from "../src/auth.ts";
import { authPath } from "../src/paths.ts";

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
});
