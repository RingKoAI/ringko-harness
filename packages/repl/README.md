# @ringko-ai/repl

Interactive terminal UI for RingKo, built with [Ink](https://github.com/vadimdemedes/ink)
(React for the terminal). The layout follows the model used by Claude Code /
OpenClaude: a transcript, a live status/spinner row, an approval dialog, a
bordered input bar, and a status line.

```
 ✻ RingKo  agent harness
 model · /path/to/workspace
 ❯ user message
 ⏺ assistant text
 ⏺ read_file
   ⎿  <result>
 ⠹ Running…  (esc to interrupt)
 ┌ Approve run_shell? ─────────────┐
 │ shell · high                     │
 │ Run echo hello                   │
 │ y approve · n reject             │
 └──────────────────────────────────┘
 ❯ type a message, or /help
 model · workspace · session-… · /help
```

- Risky tool calls block on the approval dialog (`y`/`n`) — the harness stays the
  only execution boundary.
- The conversation is recorded to `~/.ringko/sessions`.
- Slash commands: type `/` to see hints (filtered as you type). Built-ins:
  `/help`, `/clear`, `/exit`, `/model`, `/workspace`, `/session`, `/tools`,
  `/skills`, `/mcp`.

Launch it with `ringko tui` (the CLI resolves the provider and passes the model
in), or `launchRepl({ model, modelLabel, config, workspace })` from a host.
