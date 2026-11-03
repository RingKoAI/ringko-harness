<p align="center">
  <img src="icon/ringko.svg" alt="RingKo Harness" width="96" height="96">
</p>

<h1 align="center">RingKo Harness</h1>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <a href="https://github.com/RingKoAI/ringko-harness/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/RingKoAI/ringko-harness/ci.yml?branch=main&label=ci&style=flat-square" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/v/@ringko-ai/rkh?label=npm&style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/dm/@ringko-ai/rkh?label=downloads&style=flat-square" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-1A73E8?style=flat-square" alt="Apache-2.0 license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white&style=flat-square" alt="Node.js 24 or newer"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-%E2%89%A51.2-fbf0df?logo=bun&logoColor=black&style=flat-square" alt="Bun 1.2 or newer"></a>
</p>

RingKo Harness is the runtime layer behind a coding agent. It owns the parts that
make an agent dependable in a real repository: which tools exist, whether a call
is allowed, where it runs, what the model remembers, and how long work is split,
tracked and resumed. The chat window is only one client on top.

Models are replaceable. Interfaces are replaceable. The guarantees are not.

## Design principles

- **The model is a dependency, not the architecture.** Every model enters through
  the same `ModelClient` contract. Provider differences — reasoning replay,
  thinking budgets, tool-result shapes — are handled at the adapter boundary, so
  the tool loop and session format stay provider-neutral.
- **Authority is explicit and fail-closed.** Every tool call is risk-classified
  and passes the host's approval gate. With no handler, risky operations are
  denied. Network tools and shell execution are capabilities a host opts into,
  not defaults.
- **Session state is data.** A session is an append-only JSONL event log, not
  process memory. That is what makes resume, fork, trajectory inspection and
  multi-client synchronization possible without a second source of truth.
- **One runtime, several surfaces.** The terminal UI, browser UI and SDK are
  built on the same registry, approval gate and session model. The TUI and Web
  UI can also attach to one shared backend, so a run started in one surface can
  be inspected or continued in the other.

## Quick start

RingKo is published as `@ringko-ai/rkh`. It installs a single `ringko` command
that starts either interface. Node.js 24+ and Bun 1.2+ must both be on `PATH`;
the executable is a Bun bundle, so Bun is not optional.

```sh
npm install -g @ringko-ai/rkh
ringko          # terminal interface (default)
ringko serve    # local backend + browser interface, prints its URL (port 8787)
```

`ringko help` lists every command. `npx @ringko-ai/rkh tui` runs without a global
install. From a source checkout, every `ringko <command>` below maps to
`bun packages/tui/src/cli.ts <command>`, and `pnpm dev:tui` starts the TUI alone.

Prerelease versions publish under the `next` dist-tag:
`npm install -g @ringko-ai/rkh@next`.

## What's in the box

| Layer | Included |
| --- | --- |
| Agent runtime | Streaming turn loop, tool continuation, cancellation, automatic and manual context compaction |
| Built-in tools | `read` (text, images, PDF, notebooks), `write`, `edit`, `glob`, `grep`, `tree`, `shell`, `webfetch`, `websearch`, `ask`, `plan`, `update_plan`, `task`, `job` |
| Policy | Risk assessment, approval gate, saved permission rules, explicit confirmation before full access |
| Sandbox | `read-only`, `workspace-write`, `danger-full-access`; bubblewrap on Linux, Seatbelt on macOS, restricted tokens and job objects on Windows |
| Sessions | Event-sourced JSONL, resume, fork, trajectory view, usage statistics |
| Delegation | `read` / `write` / `full` subagents with independent context and an optional model, background execution, cancellation, live progress |
| Extensibility | MCP servers, skills, `AGENTS.md` instructions, custom providers, host SDK |

Every tool invocation passes through the approval gate. A host that supplies no
approval handler gets a closed door, not a permissive default.

## One backend, one session log

`ringko` and `ringko serve` share one backend per canonical workspace/config
pair. The backend records its owner in `~/.ringko/backends/`; TUI startup
discovers that record (with the rendezvous port and the legacy 8787 port as
fallbacks) and attaches instead of starting a second backend. A second `serve`
for the same workspace/config prints the existing URL and exits; a competing
programmatic backend is rejected. Open the printed backend URL in a browser,
then select the same session in both clients (`ringko -s <id>`). Messages,
partial output, tool activity, approvals, questions, plans and running state
synchronize through that one process. Disconnecting a client does not cancel a
run; use the client's explicit stop action. Concurrent submissions to a busy
session return HTTP 409.

`ringko` and `ringko serve` default to the **active registered project**, not the
directory they were launched from. `--workspace` is an explicit override for CLI
compatibility. With no registered project, the launch directory is used only as
a first-run bootstrap so the UI can add one. Skills and MCP configuration are
resolved from the selected project, plus the documented shared and global roots.

`ringko run` / `loop` and an embedded REPL still execute locally and are not yet
routed through the owning backend. Do not point them at a session that another
live backend is writing.

```sh
ringko service status             # the local backend started by `ringko`
ringko service stop
# Optional manual backend and explicit connection:
ringko serve --shared --workspace /path/to/project --port 8787
ringko --workspace /path/to/project --server http://127.0.0.1:8787
```

See the [TUI package README](packages/tui/README.md#shared-backend) for the
shared-backend contract and its limits.

## Execution boundary

Host execution defaults to `sandbox.mode = "workspace-write"`. The three modes
are `read-only`, `workspace-write`, and the explicit `danger-full-access`.
`read-only` denies persistent writes; `workspace-write` permits workspace and
explicit extra-root writes. `danger-full-access` removes those limits and has to
be selected deliberately. Missing runners fail closed rather than falling back to
host execution.

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": []
  }
}
```

Linux uses bubblewrap, macOS uses Seatbelt, and Windows uses restricted tokens,
Low integrity, capability-SID write ACLs, and kill-on-close job objects. Windows
PTYs use a native ConPTY host under the same token boundary. Native helper source
is embedded in npm bundles and standalone binaries; no source sidecar is needed.
Local MCP, explicit REPL commands, file writes and workspace Git review follow
the sandbox policy. Remote MCP requires endpoint-bound grants in host settings;
a server's read-only hint cannot grant authority. See
[Sandbox boundaries and configuration](SANDBOX.md) for setup, prerequisites,
verified behavior and the remaining write-confinement limits.

## Sessions, delegation and plans

A session is an append-only event log. Resume it, fork it before a message, or
open **Trajectory** above the chat to inspect recorded user, model, assistant,
tool, task, compaction and session events. The sequence strip selects an event;
the inspector shows its stored data, including failed tool results. Filters and
search apply to loaded event summaries. The active view polls every three
seconds and can load older events.

`GET /api/sessions/:id/trajectory` requires the same authorization as other
session endpoints. Pages contain at most 50 events; `before` and `after` are
exclusive sequence cursors. The browser retains at most 1,000 events and caps
event details at 32,768 characters; complete records remain in the session
JSONL. Tool duration uses recorded call/result timestamps. Model events reflect
the run-level log; per-step token usage and model latency are not yet recorded.
Open **Settings → Usage statistics** for workspace and session usage summaries,
filters, trends and paginated call history; see
[Usage statistics](docs/usage-statistics.md) for the data semantics and limits.

`task` runs subagents in `read`, `write` or `full` mode. Children have
independent context and may select a configured model. `write` auto-approves
workspace edits; `full` opens every capability the parent already has. Tasks
support background execution, event subscriptions and cancellation, and
completion returns the result to the parent model. `ask` renders questions in
the TUI and Web UI; `plan` reads the session plan and `update_plan` replaces it
as a whole. Existing plan snapshots and saved permission/workflow rules remain
valid.

The TUI shows running subagents below the prompt with their latest activity;
Web chat shows a running-subtask row with an inspect action; `ringko run` prints
subagent start, tool and result events. The trajectory links task events by task
id and child turn, so a delegated run can be read as part of the parent session.

## User-level resources

Configuration, skills and MCP servers live outside the project, under two roots
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
`GET /api/mcp/connected` only reports current connections, and MCP configuration
cannot change while a session is running.

### Instruction context

Runtime-managed agents reload applicable global/project `AGENTS.md` (or project
`CLAUDE.md` as a fallback) before every main-model request, including tool
continuations and requests after automatic or manual compaction. Current rules
replace earlier runtime instruction blocks while conversation summaries remain
separate. Resume loads rules from disk even when the stored history contains only
a summary. Deleted rules are removed; unreadable or oversized discovered files
fail the request instead of silently omitting policy. Limits are 256 KiB per
file, 1 MiB of file content in total, and 64 files. Rule changes invalidate
earlier input-token estimates. Compaction requests use their own summarization
prompt.

Standalone SDK hosts can supply `resolveInstructions` for the same per-request
refresh behavior. Ambient file discovery is provided by `RuntimeManager`.

## Workspace awareness

The model gets a native `tree` tool for directory structure instead of shelling
out to the OS `tree` command. It supports depth and entry limits, hidden-file and
exclusion controls, and external-path approval. `read` returns plain text for
source files, directories and notebooks, and extracts images and PDFs as content
the model can actually consume. `glob` and `grep` cover file discovery and
search; `write` and `edit` are the only paths that mutate the workspace.

## Providers

The backend resolves model token limits once and uses them for both context API
responses and SDK compaction. WebUI and TUI clients read the backend's context
limit. Missing capacity fields are filled from
[Models.dev](https://models.dev/api.json). RingKo owns its cache under
`~/.ringko/cache/models-<source-hash>.json` and ships an offline metadata
snapshot. Cached and snapshot data is available immediately; access triggers a
background refresh after one hour, with a five-minute retry delay on failure.
Failed downloads or writes retain previous metadata. `RINGKO_MODELS_URL` can
select a public JSON mirror; provider credentials are never sent to that URL.
Remote mirrors require HTTPS; HTTP is accepted only for loopback development
mirrors. The daily snapshot workflow updates both model names and capacity
metadata.

Explicit model `contextWindow`, `maxInputTokens` and `maxOutputTokens` win over
catalog fields. Legacy `maxInputTokens` alone still overrides the context window.
Matching uses provider endpoints and identities, exact model IDs and unambiguous
canonical IDs; `catalogId: "provider/model-id"` maps a custom alias without
changing the requested model ID. Local models require this explicit mapping to
use catalog metadata. Automatic values are not saved into user configuration or
model prompts.

The total context window and the input-only cap are distinct. The normal
reserved output budget is 4,096 tokens, capped by the catalog's output ceiling;
an explicit `maxOutputTokens` replaces that budget. Unmatched models use the
shared 128,000-token window, a running budget rather than a detected capacity.
Standalone SDK callers use the same defaults unless their host supplies limits.
Models.dev's notice is included in [NOTICE](NOTICE).

Model providers are adapted from the [Vercel AI SDK](https://ai-sdk.dev).
`@ringko-ai/providers` wraps any AI SDK language model as a harness
`ModelClient`; the harness still owns the tool loop and approval gate, because
tools are declared without `execute`, so the SDK returns tool calls and stops.
Thinking levels are mapped to each provider's own field: Anthropic `thinking` and
`effort`, Google `thinkingConfig`, OpenAI `reasoningEffort`, and the exact
provider-option key for hyphenated OpenAI-compatible endpoints. Assistant
reasoning is replayed only in the form the active provider accepts; foreign
reasoning is dropped instead of being relabelled when the provider changes.

Providers are introduced **through configuration** and loaded at run time, so
they are never compiled into the CLI binary:

```json
{ "provider": { "name": "openai", "model": "gpt-4o-mini" } }
```

Custom OpenAI-compatible endpoints and provider modules can be supplied through
the same configuration and are imported at run time. Keep credentials in the
environment or user-level config, never in the repository; the examples use
placeholders only. A VS Code extension exists as an early host package
(`packages/code`); it is not yet a full surface.

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

The npm package bundles the CLI, built-in providers and the built WebUI. The
browser's interactive terminal uses Node.js and the `node-pty` dependency.
Custom provider modules configured by the host are loaded separately at runtime.
See [unreleased changes](CHANGELOG/unreleased.md) and the
[changelog](CHANGELOG/) for changes after the last release.

## Documentation

The per-package READMEs document each package's API and operational details.
This README and its Chinese counterpart are the top-level reference. If they
disagree, the English version wins.

## License

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)
