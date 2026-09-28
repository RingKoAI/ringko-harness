# @ringko-ai/repl

Interactive terminal UI for RingKo, built with Ink and React.

## Layout

The screen contains a compact header, a scrollable transcript, a live operation
indicator, tool approvals, a bounded editor or selector, and a model/status footer.

- `/model` opens model search grouped by provider; `/connect` browses providers.
- `/resume` restores a session and its visible conversation; `/new` starts a new one.
- Type `/` for command suggestions. Tab completes; Enter runs the selected command.
- Prompt history retains the last 100 entries in memory. A draft survives selector
  navigation and history browsing. Multiline paste does not submit automatically.
- PgUp/PgDn browse wrapped transcript rows. Ctrl+O expands tool output.
- Risky tool calls require explicit approval; the harness remains the execution boundary.
- Conversation records are stored in `~/.ringko/sessions`.

## Keyboard

Use `/shortcuts` to see the complete help. Main Pi-style bindings:

| Key | Action |
| --- | --- |
| Ctrl+L | Select model |
| Ctrl+P / Alt+P | Next / previous model |
| Shift+Tab | Cycle reasoning depth |
| Ctrl+O / Ctrl+T | Toggle tool output / thinking |
| Ctrl+X | Copy last answer |
| Ctrl+R | Resume session picker |
| Shift+Enter / Alt+Enter | Insert newline |
| Esc | Interrupt run or close selector |
| Ctrl+C | Clear draft or interrupt |
| Ctrl+D | Exit only with an empty draft while idle |

Ctrl+Shift+P also cycles backward in terminals that distinguish it. Modifier
support depends on the terminal; Alt+P and Alt+Enter are portable alternatives.

Launch with `ringko tui`, or call `launchRepl({ model, modelLabel, config, workspace })`.
See [the comparison report](../../docs/TUI-COMPARISON.md) for reference code,
implemented behavior, verification scope and remaining gaps.
