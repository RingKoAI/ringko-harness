# @ringko-ai/tui

The `ringko` command-line surface. It is a thin composition root over the SDK
and the built-in tools: it wires a model provider and the workspace tools into
`createRingKo`, so every tool call still passes through the harness approval
gate.

## Commands

```sh
ringko help
ringko version
ringko info                 # access mode
ringko tools                # registered tool names
ringko skills               # installed skills (~/.ringko/skills, ~/.agents/skills)
ringko mcp                  # configured MCP servers (~/.ringko/.mcp.json)
ringko run "list the files"  # run the agent (offline `echo` provider by default)
ringko loop "fix the tests" --max-iterations 10 --completion-promise DONE  # repeat until done
ringko                       # interactive terminal UI (Ink; requires a TTY; default)
ringko service start         # explicitly keep a headless workspace backend running
ringko service status        # print backend URL
ringko service stop          # refuses while a session is running
ringko web --shared --port 8787    # foreground Web owner; reuse the shared engine
```

`run` reads `~/.ringko/settings.local.json` and `~/.ringko/provider.json` (or
`--config <path>`); `--provider`, `--model`, and `--workspace` override them. Manage the config with
`ringko config show|path|get|set|unset`. Providers are introduced through
configuration and imported at run time — they are **not** compiled into the
binary (only the offline `echo` provider is). Provider configuration details
are in maintainer notes kept outside this repository.

Without an interactive approval prompt the CLI denies risky operations, so it
fails closed; workspace reads and directory listings do not require approval.

## Terminal layout

The conversation uses shaded user messages, Markdown assistant replies and compact
tool results. Completed user turns collapse their tools into one activity summary,
including reads, writes, shell and delegated tasks across model steps. Ctrl+O
reveals the original calls, arguments and outputs in order. Failures and unknown
outcomes remain explicit. Ctrl+T toggles reasoning details.

PgUp enters history reading without following incoming stream updates. PgDn moves
back toward the latest output and restores following at the bottom. Model/session
pickers and questions use a shared pane and preserve the input draft on return.
Short terminals collapse optional task details; Windows reserves a final column
to avoid ConPTY wrap artifacts.

With `--config <path>`, model, thinking and display changes are saved to that file.

Enter `/status` to open Settings at **Stats → Overview**, with Status, Config,
Usage and Stats main pages. The command remains visible above the pane. Tab/Shift+Tab
switches main pages, R refreshes and Esc returns to the prompt. Reading
the pages does not call a model or create a session.

- **Status** shows the active session, version, backend, model/provider, cwd, MCP
  connections, settings sources and update preferences. M opens MCP; PgUp/PgDn
  scrolls. Credentials are reported by location only; URL credentials, query
  strings and fragments are hidden.
- **Config** (`/config`) edits reasoning visibility, tool expansion, startup update
  checks, automatic updates, thinking effort and access mode. Select with Up/Down,
  change with Enter/Space and filter with `/`. Saving is immediate, reports failures
  and requires an idle run. With `--config`, changes go to that file; otherwise
  they go to user settings. Automatic updates are locked when startup checks are off.
- **Usage** (`/usage`) shows the current session's reported tokens, cache usage,
  calls and output rate. Missing usage, provider quotas and costs are not estimated.
- **Stats** (`/stats`) opens a calendar heatmap and two-column overview: favorite
  model, tokens, sessions, longest session span, active days and streaks. Left/Right
  or O/M switches Overview/Models; Models shows calls, tokens and cache usage for
  every model. T cycles all history, the last 7 days and the last 30 days.
  Up/Down or PgUp/PgDn scrolls; narrow terminals stack metrics and crop the heatmap
  to recent weeks. The shared backend is required. Activity counts reported model
  calls in the terminal's local time zone; session spans include idle time.

See [Usage statistics](../../docs/usage-statistics.md) for aggregation semantics.

## Local shell commands

In the TUI, enter `!git status` or another `!command` to execute it directly in
the active workspace. These explicit human commands do not call the model or
use its tool approval policy. They retain the shell's five-minute timeout,
bounded output and process-tree cancellation through Esc or Ctrl+C.
Results appear in a tool block; Ctrl+O expands stdout/stderr. Commands and their
output are recorded by the shared backend, visible to other connected clients,
and available in subsequent model context. Embedded REPL hosts without a backend
retain the original local, non-persistent shell behavior.

## Shared backend

The terminal UI starts/reuses a headless loopback engine per canonical workspace/config
pair. Run `ringko web` to enable pages at the printed URL and hold a Web owner lease;
the Web command stays running even when it reuses an existing engine. Select the same
session in the browser and terminal to see synchronized state.
Use `--server http://127.0.0.1:<port>` or `RINGKO_SERVER` for explicit connection.
`RINGKO_WEB_TOKEN`, if configured, must match the backend; do not put credentials
in URLs. Each frontend owns one lease (three-second heartbeat, fifteen-second crash
expiry). Exiting a frontend releases only its lease; the engine remains while another
owner or accepted run/upload exists, then shuts down after a one-second idle grace.
API requests and browser tabs are not extra process owners. The last Web owner leaving
disables pages without disconnecting terminals. Explicit `service start` pins a
persistent service until `service stop`; development hosts retain their own lifetime.
Non-interactive `run`/`loop` and embedded SDK/REPL hosts remain standalone.

## Build

```sh
pnpm --filter @ringko-ai/webui build       # browser assets required first
pnpm --filter @ringko-ai/tui build          # host binary -> dist/ringko[.exe]
pnpm --filter @ringko-ai/tui run build:all  # linux/macos/windows targets
```

The executable embeds Bun; distribute the adjacent `dist/webui` directory too.
The browser's interactive PTY additionally requires Node.js and the node-pty
bridge/native dependency; these are not embedded in the executable.
On Windows, `pnpm test:sandbox:bin` verifies the relocated executable's embedded
file module, status endpoint, ConPTY startup, workspace writes and external-write denial.
