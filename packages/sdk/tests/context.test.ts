import { expect, it } from "bun:test";
import { resolveContextLimits } from "@ringko-ai/config";
import { createRingKo, type ChatMessage } from "../src/index.ts";

it("compacts according to host-supplied limits instead of an independent SDK window", async () => {
  const history: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "context fixture ".repeat(1000) }));
  for (const limits of [
    { contextWindow: 8192 },
    { contextWindow: 262_144 },
    { contextWindow: 262_144, maxInputTokens: 8192 },
  ]) {
    let summaries = 0;
    const ringko = createRingKo({
      ...resolveContextLimits({ ...limits, reserveOutputTokens: 1024 }),
      history,
      compaction: { keepRecent: 2, margin: 0 },
      smallModel: async () => { summaries++; return { content: "Short history summary", toolCalls: [] }; },
      model: async () => ({ content: "done", toolCalls: [] }),
    });
    expect((await ringko.run("Continue")).content).toBe("done");
    expect(summaries).toBe(limits.contextWindow === 8192 || limits.maxInputTokens === 8192 ? 1 : 0);
  }
});
