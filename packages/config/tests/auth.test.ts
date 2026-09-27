import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApiKey, getAuth, loadAuth, removeAuth, setAuth } from "../src/auth.ts";

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-auth-"));
  env = { RINGKO_HOME: home } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("auth store", () => {
  it("stores and reads an api credential", () => {
    setAuth("gateway", { type: "apikey", key: "secret" }, env);
    expect(getApiKey("gateway", env)).toBe("secret");
    expect(loadAuth(env).gateway).toEqual({ type: "apikey", key: "secret" });
  });

  it("stores oauth credentials and exposes the account id", () => {
    setAuth("openai", { type: "oauth", refresh: "r", access: "a", expires: 123, accountId: "acc" }, env);
    const info = getAuth("openai", env);
    expect(info).toMatchObject({ type: "oauth", accountId: "acc" });
    expect(getApiKey("openai", env)).toBeUndefined();
  });

  it("removes credentials", () => {
    setAuth("gateway", { type: "apikey", key: "secret" }, env);
    removeAuth("gateway", env);
    expect(getAuth("gateway", env)).toBeUndefined();
  });

  it("returns empty for a missing file", () => {
    expect(loadAuth(env)).toEqual({});
    expect(getApiKey("nope", env)).toBeUndefined();
  });
});
