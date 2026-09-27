import { describe, expect, it } from "bun:test";
import { withCodexStore } from "../src/openai/oauth.ts";

describe("withCodexStore", () => {
  it("forces store=false into a JSON body", () => {
    const result = withCodexStore(JSON.stringify({ model: "gpt-6-sol", input: [] })) as string;
    expect(JSON.parse(result).store).toBe(false);
  });

  it("keeps an already-false body untouched", () => {
    const body = JSON.stringify({ store: false, model: "gpt-6-sol" });
    expect(withCodexStore(body)).toBe(body);
  });

  it("passes non-JSON bodies through", () => {
    expect(withCodexStore("not json")).toBe("not json");
    expect(withCodexStore(undefined)).toBeUndefined();
  });
});
