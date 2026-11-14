# Unreleased

- Add Read only, Default and Full access permission presets that persist sandbox
  and approval together. Wire Web and terminal selectors, full-access confirmation,
  effective-mode display, busy-transition guards and MCP sandbox replacement.
  Keep legacy knobs compatible and rule management under /permissions rules.
- Allow exact-target, explicitly approved file exceptions and one-command shell
  sandbox escalation for preset-controlled calls; remembered allow rules cannot
  authorize these exceptions. Retain shell approval where networking is not isolated.
- Run Windows ACL preparation from exclusive, private UTF-8-BOM PowerShell files
  rather than long encoded command arguments that can exit 255 in a compiled
  host. Keep identical policy checks, confinement and cleanup; cover Unicode paths
  in the relocated standalone regression.
- Replace the npm Bun-script entry with a Node launcher and exact-version optional
  platform executable packages. npm users no longer need external Bun. Preserve
  installed WebUI/PTY assets, compiled backend self-launch and npm self-update
  detection; verify real tarball installs and child execution without Bun on PATH
  on every release platform before publishing the main package.
- Keep a cancelled turn's already-streamed text: the SDK persists the prefix as
  an assistant message with no tool calls, the server reports `cancelled`
  instead of an error, and WebUI/terminal transcripts show it as cancelled.
  Reasoning-only prefixes are dropped, and the next turn resumes normally.
- Stream tool-call arguments to clients as bounded, non-executable previews
  (`tool_input`), with per-call assembly, interleaving, size limits, strict
  ordering, and classified provider tool failures. Execution still requires a
  complete call, schema validation and approval.
- Render shell results for the model as plain text, returning `(no output)` when
  a command produced neither stdout nor stderr, and appending only exit code,
  timeout and truncation diagnostics. Terminal summaries keep both new and legacy
  formats and never echo raw output when collapsed.

- Handle command-level help before side effects, honor literal run arguments,
  report configured permissions in info, validate session list actions/workspaces,
  preserve explicit configuration during model discovery, and reject unsafe loop
  counts. Document Claude Code command differences and implementation priorities.
- Separate headless shared backend workers from terminal/Web frontend owners.
  Enable pages only while a Web owner is attached; keep each `web` command alive
  with its own lease. Shut down managed workers only after the final frontend and
  active work settle, with heartbeat expiry for crashed processes and atomic
  admission closure. Preserve explicitly persistent services and development hosts.
- Pin workspace switching while terminal leases exist, retain Web-only project
  switching, and reject incompatible old lifecycle hosts without force replacement.
- Add per-message Send now to the WebUI queue: stop and settle an active run,
  prioritize the selected message, preserve remaining order and attachments, and
  retain rejected submissions until backend admission. Keep loop arguments on
  queued runs and prevent completion/snapshot microtasks from overriding a pause.
- Initialize missing user settings/provider files with explicit defaults on CLI
  and direct backend startup, preserving existing files and explicit-config
  isolation with atomic, exclusive creation and private POSIX permissions.
- Make instruction recursion, exact directory/path exclusions, depth and directory
  budgets configurable; skip nested independent repositories by default while
  keeping workspace/ordinary child rules and fail-closed resource limits.
- Honor explicit files for config path/show/set/unset and report unreadable or
  malformed configuration without exposing JSON contents in parser errors.
- Preserve submitted messages when instruction preparation or agent construction
  fails, so failed first runs remain visible and recoverable from session logs.
  Restore failed drafts, keep temporary conversation ids out of URLs/backend
  requests, and allow rejected new submissions to retry session creation.
- Explain the instruction-scan directory limit with narrower-workspace guidance
  while retaining the fail-closed scan and instruction-size budgets.
- Give every provider preset an independent TS module and move runtime model
  construction, aliases and discovery into provider-owned adapters; public entry
  points use a registration table and shared HTTP mechanics.
- Make bare `/connect` type-to-configure: rank exact names and aliases first,
  start quick setup at the masked key, accept Enter to discover/save, and support
  typed model selection. Tab opens default/name/endpoint/model-ID editing.
- Add OpenCode Go to provider presets and model discovery, with API-key and
  `OPENCODE_API_KEY` authentication, a bundled model list and the documented
  Chat Completions compatibility endpoint for all Go text-model families.
- Send the RingKo client identity and stable, transport-only conversation headers
  on OpenCode Go requests, including compaction, metadata and delegated sessions.
- Turn TUI `/connect` into an API-key configuration flow: edit provider name and
  endpoint, enter a masked key, discover models or supply IDs, persist settings
  and select a model. Keep keys in auth storage and restore them on save failure.
- Respect configured API keys and custom endpoints for Anthropic model clients.
- Make Windows workspace-write usable when the caller owns a root only with
  Modify: write the capability DACL and a temporary owner grant through a
  DACL-only native call, apply the Low integrity label, then restore the exact
  DACL. When relabeling is still impossible or a large workspace exceeds the
  preparation deadline, degrade only that root to read-only, expose the
  effective sandbox mode, and cache the degraded root for a bounded retry
  window instead of re-walking the tree on every shell. Trust a root only after
  a persistent completion marker; a root label alone is not proof that existing
  children were relabeled.
- Include the spawn error, exit status and captured output in Windows sandbox
  ACL preparation failures, and retry a transient process-creation failure once.
