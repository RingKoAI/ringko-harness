# RingKo Harness

Provider-neutral agent tooling shared by the RingKo surfaces (TUI, Web UI, VS
Code extension, desktop app).

- **`packages/harness`** — provider-neutral tool registry, risk/approval gate,
  and the agent turn loop.
- **`packages/tools`** — gated built-in tools: workspace files, outbound
  network, and shell execution.
- **`packages/sdk`** — stable public facade (`createRingKo`) for hosts.
- **`packages/session`** — event-sourced session storage (`~/.ringko/sessions`).
- **`packages/providers`** — AI SDK-backed model providers (OpenAI, Anthropic).
- **`packages/repl`** — interactive Ink terminal UI (`ringko tui`).
- **`packages/tui` / `webui` / `app` / `code`** — the user-facing surfaces.

Every tool invocation passes through the harness approval gate; hosts supply the
approval handler, and risky operations fail closed when none is configured.

In the Web UI, open a session and select **Tool call log** beside the composer
controls to inspect recorded call arguments, results, status, and timestamps.
Older sessions without separate `tool/call` events remain readable. The log is
available through `GET /api/sessions/:id/tool-log` in pages of up to 100 calls.

## User-level resources

Configuration, skills, and MCP servers live outside the project, under two roots
(ringko-specific entries win on name collisions):

| Resource | Locations |
| --- | --- |
| Config | `~/.ringko/provider.json`, `~/.ringko/settings.local.json` |
| Skills | `~/.ringko/skills`, `~/.agents/skills` (and the `skill` alias) |
| MCP servers | `~/.ringko/.mcp.json`, `~/.agents/.mcp.json` |
| Sessions | `~/.ringko/sessions/**` (event-sourced JSONL) |

`RINGKO_HOME` / `AGENTS_HOME` override the home directories. Inspect them with
`ringko config show`, `ringko skills`, `ringko mcp`, and `ringko session list`.

## Providers

Model providers are adapted from the [Vercel AI SDK](https://ai-sdk.dev).
`@ringko-ai/providers` wraps any AI SDK language model as a harness
`ModelClient`; the harness still owns the tool loop and the approval gate (tools
are declared without `execute`, so the SDK returns tool calls and stops).

Providers are introduced **through configuration** and loaded at run time, so
they are never compiled into the `ringko` binary:

```json
{ "provider": { "name": "openai", "model": "gpt-4o-mini" } }
```

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for custom OpenAI-compatible
endpoints and for reading a VS Code providers file. Never commit real API keys
or endpoint URLs — the examples use placeholders only.

## Development

```sh
pnpm install
pnpm test          # harness + tools + sdk
pnpm build         # code + tui + webui
```

## License

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)
