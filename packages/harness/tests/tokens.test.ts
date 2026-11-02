import { describe, expect, it } from "bun:test";
import { estimateMessagesTokens } from "../src/tokens.ts";

describe("token estimation", () => {
  it("budgets a fixed cost per image part so compaction sees vision input", () => {
    const textOnly = estimateMessagesTokens([{ role: "tool", content: "Image a.png" }]);
    const withImage = estimateMessagesTokens([{
      role: "tool",
      content: "Image a.png",
      parts: [
        { type: "text", text: "Image a.png" },
        { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      ],
    }]);
    expect(withImage).toBe(textOnly + 1_600);
  });
});
