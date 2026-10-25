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
ringko tui                   # interactive terminal UI (Ink; requires a TTY)
ringko service start         # automatically start/reuse the workspace backend
ringko service status        # print backend URL
ringko service stop          # refuses while a session is running
ringko serve --shared --port 8787  # manually managed foreground server
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
tool results. Adjacent read/search operations collapse into an exploration summary;
Ctrl+O reveals the original calls, arguments and outputs. Failures and unknown
outcomes remain explicit. Ctrl+T toggles reasoning details.

PgUp enters history reading without following incoming stream updates. PgDn moves
back toward the latest output and restores following at the bottom. Model/session
pickers and questions use a shared pane and preserve the input draft on return.
Short terminals collapse optional task details; Windows reserves a final column
to avoid ConPTY wrap artifacts.

With `--config <path>`, model, thinking and display changes are saved to that file.

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

`tui` starts/reuses a loopback service per canonical workspace/config pair.
Open the printed URL for WebUI; select the same session to see synchronized state.
Use `--server http://127.0.0.1:<port>` or `RINGKO_SERVER` for explicit connection.
`RINGKO_WEB_TOKEN`, if configured, must match the backend; do not put credentials
in URLs. Services survive client exit; stop them explicitly with `service stop`.
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
Current Windows/Bun 1.4.2 compiled-service smoke testing hits `EPERM` creating
session directories. Use the source CLI until this packaging/runtime issue is resolved.
