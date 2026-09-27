import { describe, expect, it } from "bun:test";
import { applyProxyEnv, resolveProxy } from "../src/proxy.ts";

describe("proxy resolution", () => {
  it("prefers RINGKO_PROXY", () => {
    expect(resolveProxy({ RINGKO_PROXY: "http://a:1", HTTPS_PROXY: "http://b:2" })).toBe("http://a:1");
  });

  it("falls back to standard variables", () => {
    expect(resolveProxy({ HTTPS_PROXY: "http://b:2" })).toBe("http://b:2");
    expect(resolveProxy({ https_proxy: "http://c:3" })).toBe("http://c:3");
    expect(resolveProxy({})).toBeUndefined();
  });

  it("propagates RINGKO_PROXY onto the standard variables", () => {
    const env: NodeJS.ProcessEnv = { RINGKO_PROXY: "http://p:9" };
    applyProxyEnv(env);
    expect(env.HTTPS_PROXY).toBe("http://p:9");
    expect(env.HTTP_PROXY).toBe("http://p:9");
    expect(env.https_proxy).toBe("http://p:9");
    expect(env.http_proxy).toBe("http://p:9");
  });

  it("does not overwrite an existing standard variable", () => {
    const env: NodeJS.ProcessEnv = { RINGKO_PROXY: "http://p:9", HTTPS_PROXY: "http://keep:1" };
    applyProxyEnv(env);
    expect(env.HTTPS_PROXY).toBe("http://keep:1");
    expect(env.HTTP_PROXY).toBe("http://p:9");
  });
});
