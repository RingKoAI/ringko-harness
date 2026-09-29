# Workspace runtime

Import `RuntimeManager` from `@ringko-ai/sdk/runtime`. Create one manager per
workspace and call `createAgent(config, options, host)` for each conversation.
The host provides the model, approval UI, question UI and event presentation.
The manager owns shared MCP connections, event logging, time ticks and schedules.
Call the returned agent handle's `close()` when its session or model is replaced;
call the manager's asynchronous `close()` when the workspace shuts down.

All executing CLI, TUI and Web agents use the same assembly for project
instructions, workflows, permission modes, files, session tools, optional shell
and network capabilities, and installed skills. MCP tools initialize lazily
before the first run; concurrent agents share the same connection promise.
Individual server failures are reported while other capabilities remain usable.
Resetting MCP configuration closes old connections and reconnects on the next run.

Workflow deny rules override allow rules. Filtering runs before and after the
`run/before` hooks and covers MCP tools as well as built-in tools. Workflow model
overrides must resolve through the host's configured model allowlist. A missing
resolver or unknown model fails explicitly rather than selecting a fallback.

The typed event bus exposes ordered `run/before` and `run/after` hooks, error
notifications and agent events. `on()` returns an unsubscribe function. Before
and after hook failures reject the run; agent event observer failures are logged.
Hooks run in-process and are trusted code. They do not provide sandboxing for
untrusted plugins. This change does not implement a plugin installer or marketplace.

The `skill` tool accepts only discovered names, never caller-provided paths.
It reads at most 64 KiB from a regular file. The catalog exposes at most 256 skills;
the underlying discovery order determines which entries are included. Metadata
is discovered from the first 16 KiB of each file, keeping discovery bounded.
Files with missing or unreadable frontmatter use their directory name.
Skill files and ambient project instructions are model guidance, not executable plugin code.
User-managed skill directories may contain symlinks. Model-generated skill names
cannot select arbitrary files outside the discovered catalog.

Security verification covers workflow filtering, configured model routing,
skill input validation and size limits, shared connection initialization,
cancellation, Hook errors, schedule cleanup and host regression flows using
local fixtures. External MCP service availability is outside this verification.
The VS Code package remains a status-only extension; its model integration is
not implemented by this runtime migration.

The manager exposes `permissions.add(session, rule, scope)` for host-managed
allow/deny/ask rules. Deny takes precedence over ask, then allow; explicit ask
still requires confirmation in full access mode. Rules match the exact tool and
assessed target; an omitted target is a host-authored rule for the whole tool.
The `tool/permission` hook may decide requests without explicit deny/ask rules.
Saved rules live in `.ringko/permissions/<workspace hash>.json` under the RingKo
home directory. Writes use an exclusive lock and atomic replacement. Corrupt or
oversized policy files fail closed; repair the file to restore tool execution.
Rules are re-read before execution, so a newly saved deny cancels pending approval.
Session grants apply to one conversation; saved grants apply to that workspace.
Approval UIs provide once, session, saved and reject choices. Remembering uses the
assessed target, never a model-supplied permission pattern. A shell grant therefore
matches the same command. Policy files are trusted local configuration: local
users able to edit those files can change authorization. Diagnostics record tools
and decisions without arguments or targets.

Hosts can inspect `permissions.list(session, scope)` and remove an exact rule with
`permissions.remove(session, rule, scope)`. TUI `/permissions` manages saved and
current-session rules; Web settings manages saved rules for the active workspace.
Session rules are cleared when the workspace runtime closes, when the TUI leaves
that conversation, or when the Web host deletes its session. A running tool
rechecks policy before execution; removing an allow rule during a pending call
requires a fresh approval if the access mode would have required one.
