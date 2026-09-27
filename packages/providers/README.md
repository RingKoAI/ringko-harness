# @ringko-ai/providers

Adapts the [Vercel AI SDK](https://ai-sdk.dev) to the harness `ModelClient`, so
any AI SDK provider can back the RingKo agent.

```ts
import { createProviderClient } from "@ringko-ai/providers";
```

- `createAiSdkModelClient(model, options?)` — wrap any AI SDK `LanguageModel`.
- `resolveProviderModel({ provider, model })` — `openai` / `anthropic`.
- `createProviderClient({ provider, model, ...options })` — the two combined.

Tools are declared to the AI SDK **without** an `execute` function, so the SDK
returns the tool calls and stops; the harness runs them (or refuses them)
through its own approval gate. `toModelMessages` rebuilds the model prompt from
the harness message log, including assistant tool calls and tool results.

Provider credentials are read from the environment (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`).

## Test

```sh
pnpm --filter @ringko-ai/providers test
```

Tests use `MockLanguageModelV4` from `ai/test`, so they run without network
access.
