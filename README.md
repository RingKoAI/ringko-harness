# RingKo Harness

Provider-neutral agent tooling shared by the RingKo surfaces (TUI, Web UI, VS
Code extension, desktop app).

- **`packages/harness`** — provider-neutral tool registry, risk/approval gate,
  and the agent turn loop.
- **`packages/tools`** — gated built-in tools: workspace files, outbound
  network, and shell execution.
- **`packages/sdk`** — stable public facade (`createRingKo`) for hosts.
- **`packages/providers`** — AI SDK-backed model providers (OpenAI, Anthropic).
- **`packages/tui` / `webui` / `app` / `code`** — the user-facing surfaces.

Every tool invocation passes through the harness approval gate; hosts supply the
approval handler, and risky operations fail closed when none is configured.

## Providers

Model providers are adapted from the [Vercel AI SDK](https://ai-sdk.dev).
`@ringko-ai/providers` wraps any AI SDK language model as a harness
`ModelClient`; the harness still owns the tool loop and the approval gate (tools
are declared without `execute`, so the SDK returns tool calls and stops).

```ts
import { createProviderClient } from "@ringko-ai/providers";
import { createRingKo } from "@ringko-ai/sdk";

const ringko = createRingKo({
  model: createProviderClient({ provider: "openai", model: "gpt-4o-mini" }),
});
```

API keys come from the environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). The
CLI exposes this directly:

```sh
ringko run "list the files" --provider openai --model gpt-4o-mini
```

## Development

```sh
pnpm install
pnpm test          # harness + tools + sdk
pnpm build         # code + tui + webui
```

## License

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)
