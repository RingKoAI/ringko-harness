import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { loginAnthropic } from "../src/anthropic.ts";

it("keeps the PKCE verifier out of the public OAuth state value", async () => {
  let authorize: URL | undefined;
  const pending = loginAnthropic((url) => { authorize = new URL(url); }).catch((error: unknown) => error);
  const deadline = Date.now() + 5_000;
  while (!authorize && Date.now() < deadline) await Bun.sleep(20);
  try {
    expect(authorize).toBeDefined();
    const state = authorize!.searchParams.get("state") ?? "";
    const challenge = authorize!.searchParams.get("code_challenge") ?? "";
    expect(state.length).toBeGreaterThan(0);
    // How the bug manifested: state used to be the verifier itself.
    expect(createHash("sha256").update(state).digest("base64url")).not.toBe(challenge);
    const callback = new URL(authorize!.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", state);
    await fetch(callback);
    await pending;
  } finally {
    // Settle the flow even if an assertion failed before the callback.
    if (authorize) {
      const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
      callback.searchParams.set("error", "access_denied");
      await fetch(callback).catch(() => undefined);
    }
    await pending;
  }
}, 15_000);
