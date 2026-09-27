# RingKo Harness

Provider-neutral agent tooling shared by the RingKo surfaces (TUI, Web UI, VS
Code extension, desktop app).

- **`packages/harness`** — provider-neutral tool registry, risk/approval gate,
  and the agent turn loop.
- **`packages/tools`** — gated built-in tools: workspace files, outbound
  network, and shell execution.
- **`packages/sdk`** — stable public facade (`createRingKo`) for hosts.
- **`packages/tui` / `webui` / `app` / `code`** — the user-facing surfaces.

Every tool invocation passes through the harness approval gate; hosts supply the
approval handler, and risky operations fail closed when none is configured.

## Development

```sh
pnpm install
pnpm test          # harness + tools + sdk
pnpm build         # code + tui + webui
```

## License

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)
