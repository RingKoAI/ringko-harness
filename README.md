<p align="center">
  <img src="icon/ringko.svg" alt="RingKo Harness" width="96" height="96">
</p>

<h1 align="center">RingKo Harness</h1>

<p align="center">A provider-neutral Agent Harness for coding agents.</p>

<p align="center">
  <a href="https://github.com/RingKoAI/ringko-harness/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/RingKoAI/ringko-harness/ci.yml?branch=main&label=ci&style=flat-square" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/v/@ringko-ai/rkh?label=npm&style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/dm/@ringko-ai/rkh?label=downloads&style=flat-square" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-1A73E8?style=flat-square" alt="Apache-2.0 license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white&style=flat-square" alt="Node.js 24 or newer"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-%E2%89%A51.2-fbf0df?logo=bun&logoColor=black&style=flat-square" alt="Bun 1.2 or newer"></a>
  <a href="https://github.com/RingKoAI/ringko-harness/stargazers"><img src="https://img.shields.io/github/stars/RingKoAI/ringko-harness?label=stars&style=flat-square" alt="GitHub stars"></a>
</p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

RingKo is an Agent Harness. It runs a model against a workspace through a gated
tool registry and an append-only session log. It ships with a terminal UI and a
browser UI; both use the same local server.

## Run

Node.js 24+ and Bun 1.2+ must be on `PATH`. The published executable is a Bun
bundle, so Bun is not optional.

```sh
npm install -g @ringko-ai/rkh
ringko          # terminal UI (default)
ringko web      # browser UI, prints its per-workspace URL
```

`ringko help` lists all commands. `npx @ringko-ai/rkh` runs the terminal UI
without a global install. Prereleases publish under the `next` tag:
`npm install -g @ringko-ai/rkh@next`.

From a checkout:

```sh
pnpm install
pnpm build:native # source development requires a C/C++ compiler
pnpm dev:tui    # terminal UI
pnpm build      # code, tui and webui
```

## Features

- **Tools.** `read`, `write`, `edit`, `glob`, `grep`, `tree`, `shell`,
  `webfetch`, `websearch`, `ask`, `plan`, `update_plan`, `task`, `task_control`
  and `job`. `read` handles text, images, PDFs and notebooks.
- **Approval.** Every tool call is risk-classified, and risky calls wait for the
  host. With no approval handler they are denied. Network and shell tools are
  registered separately from workspace tools.
- **Sandbox.** `read-only`, `workspace-write` or `danger-full-access`. Linux uses
  bubblewrap, macOS Seatbelt, and Windows a restricted token with a job object.
- **Sessions.** Append-only JSONL. Resume, fork, or inspect events in the
  trajectory view. Usage statistics are available in the Web UI; see
  [Usage statistics](docs/usage-statistics.md) for data semantics and limits.
- **Delegation.** Subagents run in `read`, `write` or `full` mode with separate
  context and an optional model. Named providers add Claude Code, Codex, ACP and
  generic CLI backends; in-process and CLI children accept follow-ups and cold
  resume. They can run in the background, be cancelled, and report progress in
  the TUI, Web UI and `ringko run`.
- **Context.** Automatic and manual compaction, `AGENTS.md` instructions
  reloaded before every request, skills, and MCP servers.
- **Providers.** Any AI SDK model. Thinking levels map to each provider's own
  field, and missing model limits are filled from Models.dev.

## Shared sessions

`ringko` and `ringko web` start or reuse one backend per workspace/config pair
and register it under `~/.ringko/backends/`. Open the printed URL in a browser,
then select the same session in both clients with `ringko -s <id>`. Messages,
tool activity, approvals, questions, plans and running state stay in sync. A
second `web` for the same pair prints the existing URL; a concurrent submit to
a busy session returns HTTP 409. Disconnecting a client does not cancel a run.

`ringko run`, `ringko loop` and embedded REPL hosts still execute locally. Do not
point them at a session another backend is writing.

## Sandbox

Execution defaults to `workspace-write`.

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": []
  }
}
```

`read-only` denies persistent writes. `workspace-write` allows the workspace and
extra roots. `danger-full-access` removes those limits. Missing runners fail
closed. Local MCP, explicit REPL commands, file writes and Git review follow the
same policy; remote MCP needs endpoint-bound grants in host settings. See
[Sandbox](SANDBOX.md) for platform details and remaining limits.

## Sessions and tasks

A session is an append-only event log. `task` runs a subagent with independent
context; `write` auto-approves workspace edits and `full` opens every capability
the parent has. `ask` renders a question in the TUI or Web UI. `plan` reads the
session plan and `update_plan` replaces it.

The trajectory view shows user, model, assistant, tool, task, compaction and
session events. Its API returns up to 50 events per page; the browser keeps the
latest 1,000 events and caps an event's detail at 32,768 characters. Full records
stay in the session JSONL.

## Configuration

| Resource | Location |
| --- | --- |
| Config | `~/.ringko/provider.json`, `~/.ringko/settings.local.json` |
| Skills | `~/.ringko/skills`, `~/.agents/skills` |
| MCP servers | `~/.ringko/.mcp.json`, `~/.agents/.mcp.json` |
| Plugins | `~/.ringko/plugins`, `~/.agents/plugins` (trusted names in `settings.local.json`) |
| Sessions | `~/.ringko/sessions/` |

`RINGKO_HOME` and `AGENTS_HOME` override the home directories. Inspect them with
`ringko config show`, `ringko skills`, `ringko mcp` and `ringko session list`.

Providers are selected through configuration. The built-in provider module ships
with the CLI; a custom module is imported at run time. Custom OpenAI-compatible
endpoints use the same file:

```json
{ "provider": { "name": "openai", "model": "gpt-6.1-sol" } }
```

Thinking levels map to Anthropic `thinking`/`effort`, Google `thinkingConfig`,
OpenAI `reasoningEffort`, and the matching provider-options key for compatible
endpoints. Explicit `contextWindow`, `maxInputTokens` and `maxOutputTokens`
override catalog values; unmatched models use a 128,000-token working window
with a 4,096-token output reserve. Models.dev metadata is cached under
`~/.ringko/cache/`.

Runtime-managed agents reload global and project `AGENTS.md` (or project
`CLAUDE.md`) before each main-model request, including after compaction. Limits
are 256 KiB per file, 1 MiB total, and 64 files. Unreadable or oversized files
fail the request. MCP configuration cannot change while a session is running.

## Development

Use the latest Node.js 24 LTS patch, pnpm and Bun. CI resolves the current patch
on every run. A version tag matching `packages/tui/package.json` publishes
`@ringko-ai/rkh` after the release checks pass; see the
[npm release setup](packages/tui/NPM.md#automatic-npm-releases).

```sh
pnpm test          # every workspace package
pnpm build         # code + tui + webui
```

The npm package bundles the CLI, built-in providers and the WebUI. Its browser
terminal uses `node-pty`. See [unreleased changes](CHANGELOG/unreleased.md).

## Documentation

- [Configuration](docs/configuration.md)
- [MCP servers](docs/mcp.md)
- [Plugins](docs/plugins.md)
- [Providers](docs/providers.md)
- [Skills](docs/skills.md)
- [Subagents](docs/subagents.md)
- [Sandbox](SANDBOX.md)
- [Usage statistics](docs/usage-statistics.md)

Package READMEs document each package's API and behavior. This README and
[README.zh-CN.md](README.zh-CN.md) are the top-level reference; the English
version wins if they disagree.

## License

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)

## Star History

<a href="https://www.star-history.com/#RingKoAI/ringko-harness&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=RingKoAI/ringko-harness&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=RingKoAI/ringko-harness&amp;type=Date" />
    <img src="https://api.star-history.com/svg?repos=RingKoAI/ringko-harness&amp;type=Date" alt="Star History Chart" />
  </picture>
</a>
