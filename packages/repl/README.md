# @ringko-ai/repl

Interactive terminal UI for RingKo, built with Ink and React.

## Layout

The startup screen clears on the first submitted prompt or local command; `/new`
restores it for a fresh session. The active conversation contains a scrollable transcript, a live operation
indicator, tool approvals, a bounded editor or selector, and a model/status footer.

- `/model` opens model search grouped by provider; `/connect` browses providers.
- `/status` opens Settings at **Stats → Overview**, with four main pages:
  Status, Config, Usage and Stats. The command stays visible above the pane.
  Tab/Shift+Tab switches main pages; Esc returns to the prompt and R refreshes.
  Reading these pages does not invoke a model or create a session.
  - **Status:** version, session, backend address, cwd, model/provider, credential
    location, configuration sources, MCP counts and update preferences. M opens MCP;
    Up/Down or PgUp/PgDn scroll. URL credentials, query strings and fragments are hidden.
  - **Config** (`/config`): reasoning visibility, tool expansion, startup update
    checks, automatic updates, thinking effort and access mode. Up/Down selects,
    Enter/Space changes, `/` filters, and PgUp/PgDn scrolls configuration details.
    Changes persist immediately to the explicit configuration file or user settings;
    save failures are shown. Changes require an idle run. Automatic updates require
    startup checks; embedded hosts need `createModel` to change thinking effort.
  - **Usage** (`/usage`): the selected session's reported calls, tokens, cache usage
    and output rate. Missing usage, costs and provider quotas remain unreported.
  - **Stats** (`/stats`): Overview shows a year-style activity heatmap, favorite
    model, token totals, session count, longest session span, active days and streaks
    in two columns. Narrow terminals stack the metrics and show recent heatmap weeks.
    Left/Right or O/M switches Overview/Models; Models lists every reported model's
    calls, tokens and cache usage. T cycles all history, the last 7 days and the last
    30 days; Up/Down or PgUp/PgDn scrolls. This page requires the shared backend.
    Activity counts deduplicated reported model calls in the terminal's local time
    zone; session spans include idle time. See
    [Usage statistics](../../docs/usage-statistics.md) for aggregation semantics.
- `/resume` restores a session and its visible conversation; `/new` starts a new one.
  In the session list, Enter opens the highlighted session; Ctrl+R renames it,
  Ctrl+F forks it (branch a copy) and Ctrl+D deletes it. The active session
  cannot be deleted.
- Type `/` for command suggestions below the input box. Up/Down selects,
  Tab completes, Enter runs the selected command and Esc dismisses the suggestions.
- `/loop <prompt> [--max-iterations N] [--completion-promise TEXT]` re-runs the
  same prompt until the reply contains `<promise>TEXT</promise>` or the iteration
  budget is spent (0 = unlimited). Esc or `/cancel-loop` stops it; the loop
  status shows in the footer.
- Prompt history retains the last 100 entries in memory. A draft survives selector
  navigation and history browsing. Multiline paste does not submit automatically.
- PgUp/PgDn browse wrapped transcript rows. Ctrl+O expands tool output.
- Tool activity folds by user turn across every model step and tool category.
  Normal completed turns collapse; live, failed, cancelled and incomplete turns
  remain visible. Ctrl+O expands all original calls in their original order.
  Assistant replies stay visible independently of the tool disclosure.
- `/agents` or Ctrl+G selects Main or a Subagent view. The tree prints the
  `main` row and each delegated task with a `●`/`○` viewed marker, a `▶`/`⏸`
  run state, elapsed time and tool count; child tool calls and responses remain
  in their own transcript. The most recent 32 tasks are restored from session
  events on resume; session history itself remains unchanged.
- The todo panel summarizes progress as `N tasks (X done, Y in progress, Z open)`
  and lists `✔` completed (struck through), `▪` in-progress and `▫` pending
  rows, using the active-form label while a task runs.
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
| Ctrl+G | Main / Subagent task views |
| Shift+Enter / Alt+Enter | Insert newline |
| Esc | Interrupt run or close selector |
| Ctrl+C | Clear draft or interrupt |
| Ctrl+C ×2 | Exit (second press within 800 ms) |
| Ctrl+D | Exit only with an empty draft while idle |

Ctrl+Shift+P also cycles backward in terminals that distinguish it. Modifier
support depends on the terminal; Alt+P and Alt+Enter are portable alternatives.

Launch with `ringko`, or call `launchRepl({ model, modelLabel, config, workspace })`.
The comparison report covering reference code, implemented behavior,
verification scope and remaining gaps is a maintainer note kept outside this
repository.
