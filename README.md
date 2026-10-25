# RingKo Harness

English | [简体中文](README.zh-CN.md)

Provider-neutral agent tooling shared by the RingKo surfaces (TUI, Web UI,
VS Code extension).

- **`packages/harness`** — provider-neutral tool registry, risk/approval gate,
  and the agent turn loop.
- **`packages/tools`** — gated built-in tools: workspace files, outbound
  network, and shell execution.
- **`packages/sdk`** — stable public facade (`createRingKo`) for hosts.
- **`packages/session`** — event-sourced session storage (`~/.ringko/sessions`).
- **`packages/providers`** — AI SDK-backed model providers (OpenAI, Anthropic).
- **`packages/repl`** — interactive Ink terminal UI (`ringko tui`).
- **`packages/protocol` / `client`** — platform-neutral wire contracts and shared HTTP/SSE client.
- **`packages/app/src/services`** — backend-owned synchronization and in-flight run state.
- **`packages/tui` / `webui` / `app` / `code`** — the user-facing surfaces.

Every tool invocation passes through the harness approval gate; hosts supply the
approval handler, and risky operations fail closed when none is configured.

## Install and first run

The CLI is published on npm as `@ringko-ai/rkh` and is meant to be installed
globally. It needs Node.js 24+ **and** Bun 1.2+ on `PATH` — the executable is a
Bun bundle, so Bun is not optional:

```sh
npm install -g @ringko-ai/rkh
ringko tui
```

`ringko help` lists commands; `npx @ringko-ai/rkh tui` runs without a global
install. From a source checkout, every `ringko <command>` in this document maps to
`bun packages/tui/src/cli.ts <command>`, and `pnpm dev:tui` starts the TUI.

In the Web UI, open a session and select **Tool call log** beside the composer
controls to inspect recorded call arguments, results, status, and timestamps.
Older sessions without separate `tool/call` events remain readable. The log is
available through `GET /api/sessions/:id/tool-log` in pages of up to 100 calls.

### Shared terminal/browser sessions

`ringko tui` automatically starts or reuses a local backend for the canonical
workspace/config pair. Open the printed backend URL in a browser, then select
the same session in both clients (`ringko tui -s <id>`). Messages, partial output,
tool activity, approvals, questions, todos and running state synchronize.
Disconnecting a client does not cancel a run; use the client's explicit stop action.
Concurrent submissions to a busy session return HTTP 409.

```sh
ringko service status             # the local backend started by `ringko tui`
ringko service stop
# Optional manual backend and explicit connection:
ringko serve --shared --workspace /path/to/project --port 8787
ringko tui --workspace /path/to/project --server http://127.0.0.1:8787
# From a source checkout use `bun packages/tui/src/cli.ts <command>` instead,
# or `pnpm dev:tui` for the TUI alone.
```

Shared backend architecture and limitations are documented in maintainer
notes kept outside this repository.

### Delegated tasks

CLI, TUI and Web chat support `task` with `mode: "read"`, `"write"` or `"full"`.
Write mode auto-approves workspace edits; full mode opens all parent-configured
capabilities. Children have independent context and may select a configured model.
Task and shell support background execution, event subscriptions and cancellation;
completion resumes the parent model with results. `ask` renders questions in TUI/Web;
`todowrite`/`todoread` persist and restore the session plan. Task and job tool
limits and permission boundaries are documented in maintainer notes kept
outside this repository.

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

## Directory structure

For directory structure, the model has a native `tree` tool instead of needing
an OS `tree` command through `shell`. It supports depth/entry limits, hidden-file
and exclusion controls, and external-path approval.

## Providers

Model providers are adapted from the [Vercel AI SDK](https://ai-sdk.dev).
`@ringko-ai/providers` wraps any AI SDK language model as a harness
`ModelClient`; the harness still owns the tool loop and the approval gate (tools
are declared without `execute`, so the SDK returns tool calls and stops).

Providers are introduced **through configuration** and loaded at run time, so
they are never compiled into the CLI binary:

```json
{ "provider": { "name": "openai", "model": "gpt-4o-mini" } }
```

Custom OpenAI-compatible endpoints and reading a VS Code providers file are
covered by maintainer notes kept outside this repository. Never commit real API
keys or endpoint URLs — the examples use placeholders only.

## Development

Use the latest Node.js 24 LTS patch release (see `.node-version`), pnpm and Bun.
CI resolves the latest Node.js 24 patch on each run to pick up security fixes.

Pushing a version tag matching `packages/tui/package.json` publishes
`@ringko-ai/rkh` to npm after the release builds and checks succeed. See
[npm release setup](packages/tui/NPM.md#automatic-npm-releases) for the required
npm Trusted Publisher configuration and local package verification commands.

```sh
pnpm install
pnpm test          # every workspace package
pnpm build         # code + tui + webui
```

## Documentation

Design notes, the comparison report and tool references are maintainer documents
kept outside this repository. This README and the per-package READMEs are the
in-repo reference.

## License

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)
