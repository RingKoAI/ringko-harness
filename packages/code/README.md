# RingKo Code (`@ringko-ai/code`)

VS Code / Cursor / Windsurf IDE extension for **RingKo Agent Harness**.

`@ringko-ai/code` attaches to the same shared local RingKo backend (`"ide"` frontend lease) used by the CLI/TUI and WebUI — zero duplicate processes, zero native Node-API ABI lock-in, and real-time session synchronization across all three surfaces.

## Key Capabilities

- **Native Sidebar Chat (`ringko.chatView`)**: Live SSE token, reasoning, and tool-activity streaming styled automatically with your active VS Code theme.
- **Mid-Run Steering & Follow-Up Queue**: Inject mid-run steering instructions (`Ctrl/Cmd+Enter` or **Steer** button) at the next step boundary, or queue follow-ups for FIFO execution.
- **Clipboard Screenshot Paste & Drag-and-Drop Uploads**: Paste images with `Ctrl/Cmd+V`, drag files onto the sidebar, or pick attachments directly (`<= 20 MiB` per file, up to `16` files).
- **Editor Context & Diagnostics Integration**:
  - `RingKo: Add File / Selection to Chat` (`Ctrl+Alt+K` / `Cmd+Alt+K`) — inserts `@path/to/file.ts#L10-L25`.
  - `RingKo: Explain Selected Code` — sends bounded code selection with language context.
  - `RingKo: Fix File Diagnostics` — sends active file Errors & Warnings to RingKo.
  - Clickable `@file#L10` references in chat jump straight to the target file and line inside the workspace.
- **Inline Approvals & Clarifications**: Approve tool executions (`Allow Once`, `Session`, `Always`, `Deny`) inline or via VS Code notifications when the sidebar is hidden.
- **1-Click TUI & WebUI Handoff**: Launch `ringko tui` in a side-by-side integrated terminal (`Ctrl+Shift+Escape` / `Cmd+Shift+Escape`) or open the browser WebUI sharing the exact same live session.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `ringko.serverUrl` | `""` | Explicit loopback HTTP backend URL (`http://127.0.0.1:<port>`). Leave empty for automatic workspace discovery. |
| `ringko.authToken` | `""` | Optional bearer token when the backend requires `RINGKO_WEB_TOKEN`. |
| `ringko.cliPath` | `"ringko"` | Path or command name of the `ringko` CLI executable. |
| `ringko.autoStartBackend` | `true` | Automatically start `ringko service serve` when no live backend is running for the workspace. |

## Development

```bash
pnpm --filter @ringko-ai/code test
pnpm --filter @ringko-ai/code build
```
