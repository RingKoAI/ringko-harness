import { createApp } from "./index.ts";

const app = createApp({
  workspace: process.cwd(),
  model: async () => ({ content: "RingKo App is not wired to a model yet.", toolCalls: [] }),
});

process.stdout.write(`RingKo App workspace: ${app.workspace}\n`);
