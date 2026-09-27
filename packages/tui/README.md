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
ringko run "list the files"  # run the agent (offline `echo` provider by default)
```

`run` accepts `--provider <name>` and `--workspace <dir>`. Without an
interactive approval prompt the CLI denies risky operations, so it fails closed;
workspace reads and directory listings do not require approval.

## Build

```sh
pnpm --filter @ringko-ai/tui build          # host binary -> dist/ringko[.exe]
pnpm --filter @ringko-ai/tui run build:all  # linux/macos/windows targets
```

The result is a single self-contained executable with the Bun runtime embedded.
