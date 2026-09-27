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
ringko tui                   # interactive terminal UI (Ink; requires a TTY)
```

`run` reads `~/.ringko/settings.local.json` and `~/.ringko/provider.json` (or
`--config <path>`); `--provider`, `--model`, and `--workspace` override them. Manage the config with
`ringko config show|path|get|set|unset`. Providers are introduced through
configuration and imported at run time — they are **not** compiled into the
binary (only the offline `echo` provider is). See
[docs/PROVIDERS.md](../../docs/PROVIDERS.md).

Without an interactive approval prompt the CLI denies risky operations, so it
fails closed; workspace reads and directory listings do not require approval.

## Build

```sh
pnpm --filter @ringko-ai/tui build          # host binary -> dist/ringko[.exe]
pnpm --filter @ringko-ai/tui run build:all  # linux/macos/windows targets
```

The result is a single self-contained executable with the Bun runtime embedded.
