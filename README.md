<p align="center">
  <img src="icon/ringko.svg" alt="RingKo Harness" width="96" height="96">
</p>

# RingKo Harness

English | [简体中文](README.zh-CN.md)

RingKo Harness is a set of provider-neutral **Agent Harness** facilities rather
than a single chat front end. The packages provide the tool registry and
risk/approval gate, event-sourced sessions, context compaction, delegated tasks,
MCP, skills, and a host-facing SDK. The installed `ringko` command is one built-in
surface over them: an interactive terminal UI (plain `ringko`, the default) and a
browser UI (`ringko serve`). A VS Code extension is in progress. Every interface
runs the same registry, approval gate and session log, so a session started in one
can be inspected and resumed in the other.

The packages below are the harness itself:

- **`packages/harness`** —provider-neutral tool registry, risk/approval gate,
  and the agent turn loop.
- **`packages/tools`** —gated built-in tools: workspace files, outbound
  network, and shell execution.
- **`packages/sdk`** —stable public facade (`createRingKo`) for hosts.
- **`packages/session`** —event-sourced session storage (`~/.ringko/sessions`).
- **`packages/providers`** —AI SDK-backed model providers (OpenAI, Anthropic).
- **`packages/repl`** —interactive Ink terminal UI (`ringko`).
- **`packages/protocol` / `client`** —platform-neutral wire contracts and shared HTTP/SSE client.
- **`packages/app/src/services`** —backend-owned synchronization and in-flight run state.
- **`packages/tui` / `webui` / `app` / `code`** —the user-facing surfaces.

Every tool invocation passes through the harness approval gate; hosts supply the
approval handler, and risky operations fail closed when none is configured.

## Install and first run

RingKo is published on npm as `@ringko-ai/rkh` and is meant to be installed
globally. It installs one command, `ringko`, which starts either interface. It
needs Node.js 24+ **and** Bun 1.2+ on `PATH` —the executable is a Bun bundle, so
Bun is not optional:

```sh
npm install -g @ringko-ai/rkh
ringko          # terminal interface (default)
ringko serve    # local backend + browser interface, prints its URL (port 8787)
```

`ringko help` lists commands; `npx @ringko-ai/rkh tui` runs without a global
install. From a source checkout, every `ringko <command>` in this document maps to
`bun packages/tui/src/cli.ts <command>`, and `pnpm dev:tui` starts the TUI.

In the Web UI, open **Settings → Usage statistics** for workspace/session
summaries, date/provider/model filters, trends and paginated call history.
See [Usage statistics](docs/usage-statistics.md) for data semantics and limits.
Open a session's **Trajectory** view to inspect its recorded events.
The compact status row below the composer shows generation speed, session cache
hit rate, and context usage. Speed uses the most recent recorded primary call's
actual output tokens divided by its total duration, including initial wait;
compaction, metadata and delegated calls do not replace that speed. Missing
historical timing/cache data stays unknown.
Older sessions without separate `tool/call` events remain readable. Tool logs are
available through `GET /api/sessions/:id/tool-log` in pages of up to 100 calls.

### Shared terminal/browser sessions

`ringko` and `ringko serve` share one backend per canonical workspace/config
pair. The backend records its owner in `~/.ringko/backends/`; TUI startup
discovers that record (with the rendezvous port and the legacy 8787 port as
fallbacks) and attaches instead of starting a second backend. A second `serve`
for the same workspace/config prints the existing URL and exits; a competing
programmatic backend is rejected. Open the printed backend URL in a browser,
then select the same session in both clients (`ringko -s <id>`). Messages,
partial output, tool activity, approvals, questions, todos and running state
synchronize through that one process. Disconnecting a client does not cancel a
run; use the client's explicit stop action. Concurrent submissions to a busy
session return HTTP 409.

`ringko` and `ringko serve` default to the **active registered project**, not the
directory they were launched from. `--workspace` is an explicit override for
CLI compatibility. With no registered project, the launch directory is used only
as a first-run bootstrap so the UI can add one. Skills and MCP configuration are
resolved from the selected project (plus the documented shared/global roots).

`ringko run` / `loop` and an embedded REPL still execute locally and are not yet
routed through the owning backend; avoid pointing them at a session that another
live backend is writing.

```sh
ringko service status             # the local backend started by `ringko`
ringko service stop
# Optional manual backend and explicit connection:
ringko serve --shared --workspace /path/to/project --port 8787
ringko --workspace /path/to/project --server http://127.0.0.1:8787
# From a source checkout use `bun packages/tui/src/cli.ts <command>` instead,
# or `pnpm dev:tui` for the TUI alone.
```

Shared backend architecture and limitations are documented in maintainer
notes kept outside this repository.

### Sandbox

Host execution defaults to `sandbox.mode = "workspace-write"`. The three modes
are `read-only`, `workspace-write`, and the explicit `danger-full-access`.
`read-only` denies persistent writes; `workspace-write` permits workspace and
explicit extra-root writes. `danger-full-access` explicitly removes those
limits. Missing runners fail closed rather than falling back to host execution.

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": []
  }
}
```

Linux uses bubblewrap, macOS uses Seatbelt, and Windows uses restricted tokens,
capability-SID write ACLs, Low integrity, and kill-on-close jobs. Windows PTYs use
a native ConPTY host with the same token boundary. Native helper source is
embedded in npm bundles and standalone binaries; no source sidecar is needed.
Local MCP, explicit REPL commands, file writes and workspace Git review follow
the sandbox policy. Remote MCP requires endpoint-bound grants in host settings;
server read-only hints cannot grant authority. See [Sandbox boundaries and
configuration](SANDBOX.md) for setup, prerequisites, verified behavior, and the
remaining write-confinement limitations.

### Delegated tasks

CLI, TUI and Web chat support `task` with `mode: "read"`, `"write"` or `"full"`.
Write mode auto-approves workspace edits; full mode opens all parent-configured
capabilities. Children have independent context and may select a configured model.
Task and shell support background execution, event subscriptions and cancellation;
completion resumes the parent model with results. `ask` renders questions in TUI/Web;
`plan` reads the session plan and `update_plan` replaces the full list.
Existing session plan snapshots and saved permission/workflow rules remain valid.
Prompts and skills using the old tool names must be updated; see [migration notes](CHANGELOG/v0.4.5.md#tool-migration).
Task and job tool limits and permission boundaries are documented in maintainer notes kept
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

Skill discovery is layered: the project root wins, then shared `.agents` /
`.ringko` skill directories in ancestor workspaces **inside the user home**, then
the home-level roots above. This lets a nested repository use skills installed by
its parent projects directory. MCP registration loads at backend startup;
`GET /api/mcp/connected` only reports the current connections, and MCP
configuration cannot be changed while a session is running.

### Instruction context

Runtime-managed agents reload applicable global/project `AGENTS.md` (or project
`CLAUDE.md` fallback) before every main-model request, including tool continuations
and requests after automatic/manual compaction. Current rules replace earlier
runtime instruction blocks while conversation summaries remain separate. Resume
loads rules from disk even when the stored history contains only a summary.
Deleted rules are removed; unreadable or oversized discovered files fail the
request instead of silently omitting policy. Limits are 256 KiB per file, 1 MiB
of file content in total, and 64 files. Rule changes invalidate earlier input-token
estimates. Compaction requests use their own summarization prompt.

Standalone SDK hosts can supply `resolveInstructions` for the same per-request
refresh behavior. Ambient file discovery is provided by `RuntimeManager`.

## Directory structure

For directory structure, the model has a native `tree` tool instead of needing
an OS `tree` command through `shell`. It supports depth/entry limits, hidden-file
and exclusion controls, and external-path approval.

## Providers

The backend resolves model token limits once and uses them for both context API
responses and SDK compaction. WebUI/TUI clients read the backend's context limit.
Missing capacity fields are filled from [Models.dev](https://models.dev/api.json).
RingKo owns its cache under `~/.ringko/cache/models-<source-hash>.json` and ships an
offline metadata snapshot. Cached/snapshot data is available immediately; access
triggers a background refresh after one hour, with a five-minute retry delay on
failure. Failed downloads or writes retain previous metadata. `RINGKO_MODELS_URL`
can select a public JSON mirror; provider credentials are never sent to this URL.
Remote mirrors require HTTPS; HTTP is accepted only for loopback development mirrors.
The daily snapshot workflow updates both model names and capacity metadata.

Explicit model `contextWindow`, `maxInputTokens`, and `maxOutputTokens` win over
catalog fields. Legacy `maxInputTokens` alone still overrides the context window.
Matching uses provider endpoints/identities, exact model IDs and unambiguous
canonical IDs; `catalogId: "provider/model-id"` maps a custom alias without changing
the requested model ID. Local models require this explicit mapping to use catalog
metadata. Automatic values are not saved into user configuration or model prompts.

The total context window and input-only cap are distinct. The normal reserved
output budget is 4,096 tokens, capped by the catalog's output ceiling; an explicit
`maxOutputTokens` replaces that budget. Unmatched models use the shared 128,000-token
window, a running budget rather than a detected capacity. Standalone SDK callers
use the same defaults unless their host supplies limits. Models.dev's notice is
included in [NOTICE](NOTICE).

Headless CLI and standalone embedded REPL hosts use the same shared resolver.
See [unreleased fixes](CHANGELOG/unreleased.md) for changes after `v0.4.5`.

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
keys or endpoint URLs —the examples use placeholders only.

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




