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

### Delegated tasks

CLI, TUI and Web chat support `task` with `mode: "read"`, `"write"` or `"full"`.
Write mode auto-approves workspace edits; full mode opens all parent-configured
capabilities. Children have independent context and may select a configured model.
Task and shell support background execution, event subscriptions and cancellation;
completion resumes the parent model with results. `ask` renders questions in TUI/Web;
`todowrite`/`todoread` persist and restore the session plan. See
[Task and job tools](docs/TASK-TOOL.md) for limits and permission boundaries.

### Session trajectory

Select **Trajectory** above the chat to inspect recorded user, model, assistant,
tool, task, compaction, and session events. The sequence strip selects an event; the
inspector shows its stored data, including failed tool results. Filters and
search apply to loaded event summaries. The active view polls every three
seconds and supports loading older events.

`GET /api/sessions/:id/trajectory` requires the same authorization as other
session endpoints. Pages contain at most 50 events; `before` and `after` are
exclusive sequence cursors. The browser retains at most 1,000 events and event
details are capped at 32,768 characters; complete records remain in the session
JSONL. Tool duration uses recorded call/result timestamps. Model events reflect
the existing run-level log; per-step token usage and model latency are not yet
recorded.

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
