# Configuration

RingKo keeps user configuration under two roots:

| Path | Contents |
| --- | --- |
| `~/.ringko/settings.local.json` | Workspace, permissions, sandbox, capabilities, thinking, compaction, workflow |
| `~/.ringko/provider.json` | Providers, models, selected model and helper model |
| `~/.ringko/auth/auth.json` | Provider credentials, written 0600 on POSIX |
| `~/.ringko/tool.auth.json` | MCP and connector credentials, written 0600 on POSIX |
| `~/.ringko/.mcp.json` | MCP servers owned by RingKo |
| `~/.agents/.mcp.json` | MCP servers shared by agent tools |
| `~/.ringko/sessions/` | Event-sourced session logs |

`RINGKO_HOME` replaces the home directory used for `.ringko`; `AGENTS_HOME` does
the same for `.agents`. An explicit `--config <path>` is read as-is and does not
merge the user-level files.

Inspect and edit configuration with:

```sh
ringko config show
ringko config path
ringko config get permission
ringko config set permission assist
ringko config unset workflow
ringko info
```

`ringko config set` writes the user-level settings file. Secrets belong in
`~/.ringko/auth/`, not in `settings.local.json`.

## First startup

Launching the terminal UI, a Web backend, or another recognized operational or
configuration command creates missing `settings.local.json` and `provider.json`
files. Only the missing file is created when the other exists. Existing files,
including empty placeholders, are preserved byte-for-byte rather than backfilled.
Omitted scan fields use the runtime defaults below. Malformed JSON, unreadable
files and non-file configuration targets report an error and require repair.

Complete temporary files are published exclusively, so concurrent startup cannot
replace a winner. New files use `0600` on POSIX and a newly created configuration
directory uses `0700`. Help, version and unknown commands do not generate these
files. An explicit `--config <path>` also skips user-file initialization;
`config show/path/set/unset` then operate on that file. The SDK's read-only
`loadConfig()` function does not generate files.

The default provider file is:

```json
{ "model": "", "small_model": "", "providers": [] }
```

No API key or remote model is invented; the existing offline echo behavior remains
until a provider is configured. Default settings cover updates, permissions,
sandbox, capabilities, thinking/display, turn limits, compaction, plugin trust,
subagents and instruction scanning without pinning the launch directory as the
workspace. Network and shell capabilities default to disabled; the settings
example below demonstrates explicitly enabling them.

## settings.local.json

```json
{
  "workspace": "/path/to/project",
  "permission": "approval",
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": []
  },
  "capabilities": {
    "network": true,
    "shell": true,
    "privateNetwork": false,
    "websearchProvider": "exa"
  },
  "thinking": "high",
  "maxTurns": 50,
  "compaction": {
    "enabled": true,
    "ratio": 0.8,
    "keepRecent": 6,
    "margin": 2000
  }
}
```

| Key | Meaning |
| --- | --- |
| `permission` | `approval`, `assist` or `full`. Defaults to `approval`. `mode` is the legacy alias. |
| `sandbox.mode` | `read-only`, `workspace-write` or `danger-full-access`. Defaults to `workspace-write`. |
| `sandbox.additionalWritableRoots` | Extra writable directories in `workspace-write`; relative entries resolve from the workspace. |
| `capabilities.network` | Registers `webfetch` and `websearch`. Omitted means the tools are absent. |
| `capabilities.shell` | Registers `shell`. Omitted means the tool is absent. |
| `capabilities.privateNetwork` | Allows `webfetch` to reach local or private addresses. Off by default. |
| `capabilities.websearchProvider` | `exa` (default) or `parallel`. The provider key comes from `EXA_API_KEY` or `PARALLEL_API_KEY`. |
| `thinking` | `off`, `low`, `high` or `max`, mapped to the active provider's own field. |
| `maxTurns` | Tool rounds per run. Defaults to 50. |
| `compaction` | Automatic context compaction. Enabled by default at 80% of the window, keeping six recent messages. |
| `workflow` | Active workflow id from `~/.ringko/workflows.json`. |
| `subagents` | Delegated-provider registry: `default`, `maxActive`, `maxPerRun` and `providers`. See [Subagents](subagents.md). |
| `updates.checkOnStartup` | Check the latest stable CLI release on startup. Defaults to `true`. |
| `updates.autoUpdate` | Install an available update during a startup check. Defaults to `false`. |
| `instructionScan` | Recursive instruction discovery, directory exclusions and resource bounds; see below. |

## Instruction scanning

New settings files contain these defaults. Existing settings files use the same
defaults without being rewritten:

```json
{
  "instructionScan": {
    "recursive": true,
    "excludeDirectories": [".git", ".hg", ".svn", "node_modules", "dist", "build", "coverage", ".next", "target", "vendor", "venv", "__pycache__", "bower_components"],
    "excludeNestedRepositories": true,
    "maxDepth": 12,
    "maxDirectories": 4096
  }
}
```

- Recursive discovery adds nested `AGENTS.md` files. Global rules and upward
  `AGENTS.md` / `CLAUDE.md` precedence stay unchanged, even with `recursive: false`.
- `excludeNestedRepositories` skips child repositories with `.git` directories,
  Git worktree `.git` files, or `.hg` / `.svn` markers. The selected workspace
  itself is still loaded, as are ordinary child directories. Set this to `false`
  to include nested repositories.
- A single `excludeDirectories` name matches at any depth; paths containing `/`
  or `\\` match relative to the workspace root. For example, `Example` matches
  directories with that name, while `Example/reference` matches only that relative
  path. Globs, absolute paths and `..` components are not accepted. A custom array
  **replaces** the built-in exclusion list; `[]` clears it. Dot-prefixed directories
  and directory symlinks are always skipped. `.gitignore` is not consulted.
- The workspace has depth `0`. `maxDepth` accepts `0–64`; `maxDirectories` accepts
  `1–65536`, including the workspace root. Excluded directories and repositories
  do not consume the budget. Discovery stops descending at the depth boundary;
  exceeding the directory budget fails instead of silently dropping instructions
  and requesting the model.
- Invalid fields fall back individually and produce a diagnostic log entry, plus
  a notification when the host provides one. The independent instruction budgets
  remain `256 KiB` per file, `1 MiB` total and `64` files.

For a broad projects directory, prefer selecting the actual project as the
workspace, or add reference directories such as `Example` while retaining the
default exclusions you need. Updated backends read saved settings on the next
run. Restart an existing shared backend after updating program code; an old
process does not automatically load new code.

## Version updates

```json
{
  "updates": { "checkOnStartup": true, "autoUpdate": false }
}
```

```sh
ringko update --check
ringko update
ringko config set updates.checkOnStartup false
ringko config set updates.autoUpdate true
```

Startup checks apply to the terminal UI, `web`, `run`, `loop` and `service start`.
Help, version, configuration commands and backend workers do not check. Setting
`checkOnStartup` to `false` also disables automatic installation on startup;
manual `update` remains available. Explicit `--config` files are honored. Invalid
values produce a warning and use the defaults above. Checks time out after five
seconds; a failed check or installation is reported without blocking the command.

The npm registry's `latest` version is used; prereleases and downgrades are not
installed automatically. Global npm installations update their owning global
prefix. Local/npx installations must use their original package manager; source
checkouts must be pulled and rebuilt. Standalone installations download the
matching official GitHub release, verify SHA-256 and the executable's version,
then replace the binary and WebUI together with rollback on failure. The install
directory must be writable; the updater never elevates privileges. A successful
startup installation ends the launch; restart RingKo and any shared backend to
use the new version. On Windows, backups of an executable still in use may need
to be removed after exit; their location is reported.

Project-level files can also carry an `mcpServers` map; see
[MCP servers](mcp.md) for the exact lookup order.

## Access modes

### Permission presets

The terminal `/permissions` (`/permission`) command and Web composer expose the
same three presets: `read-only` pairs `approval` with a `read-only` sandbox;
`default` pairs `approval` with `workspace-write`; `full-access` pairs `full`
with `danger-full-access`. Both knobs are saved in one configuration replacement.
Full access requires explicit confirmation; the terminal Config page asks for Y,
with Esc cancelling. `/permissions rules` retains the original rule manager.
Shift+Tab continues to change effort.

`permissionPreset` records selection; the effective display is derived from
`permission` and `sandbox.mode`. Unmatched combinations display Custom permissions.
Legacy configurations retain their meaning: `permission: full` alone does not
disable confinement.

In read-only mode, write/edit require per-invocation approval scoped to the exact
canonical target. Remembered allow rules cannot substitute for that approval.
Default mode allows ordinary workspace writes and prompts for external targets.
Shell retries may request `sandbox_permissions: "workspace-write"` or
`"danger-full-access"`; explicit approval widens only that invocation, not the mode.

Switches keep the existing configuration-level scope, affecting subsequent runs
sharing that configuration. They are rejected during active runs, uploads or
interactive terminals; MCP processes are restarted under the selected sandbox.
Explicit `--config` files remain isolated. These are not session-only overrides.

Disabled shell/network capabilities, explicit deny/ask rules and additional roots
are preserved. Network tools still request approval. Current process confinement
does not isolate networking, so default mode still gates shell commands rather
than claiming Codex-equivalent network isolation with prompt-free arbitrary shells.

### Legacy approval policies

| Mode | Behavior |
| --- | --- |
| `approval` | Asks for external files, network access and shell commands. Workspace reads stay open. |
| `assist` | Asks only when the risk assessment is medium or higher. |
| `full` | Never asks. The Web UI requires a second confirmation before switching to it. |

The access mode and the sandbox are independent. A permissive sandbox does not
disable the approval gate, and `full` access does not make the sandbox wider by
itself.

## Sandbox

`read-only` denies persistent writes. `workspace-write` permits the workspace
and `additionalWritableRoots`. `danger-full-access` removes those limits.
Missing platform runners fail closed; RingKo does not fall back to an
unconfined shell. Platform details and remaining limits are in
[Sandbox](../SANDBOX.md).

Remote MCP servers need their own host grant even when the sandbox is writable;
see [MCP authorization](mcp.md#authorization). The grant lives in this file:

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "mcp": {
      "docs": {
        "url": "https://mcp.example.com/mcp",
        "readOnlyTools": ["search"],
        "allowedTools": ["create_page"]
      }
    }
  }
}
```

## Providers

Providers and model selection live in `~/.ringko/provider.json`; see
[Providers](providers.md) for the schema, credential lookup, reasoning fields
and model metadata. The active model is written as
`"<provider name>/<model id>"`, for example:

```json
{
  "model": "DeepSeek/deepseek-chat",
  "small_model": "DeepSeek/deepseek-chat",
  "providers": []
}
```

`small_model` is used for compaction and session metadata when configured.

## Environment variables

| Variable | Effect |
| --- | --- |
| `RINGKO_HOME` | Home directory that contains `.ringko`. |
| `AGENTS_HOME` | Home directory that contains `.agents`. |
| `RINGKO_SERVER` | Backend URL used instead of the discovered local service. |
| `RINGKO_WEB_TOKEN` | Shared token for the Web UI and terminal client connections. |
| `RINGKO_MODELS_URL` | Models.dev-compatible catalog or mirror URL. HTTPS is required except for loopback. |
| `RINGKO_GIT_BASH_PATH` | Git Bash executable used by Windows terminals and full-access shells. |
| `EXA_API_KEY` / `PARALLEL_API_KEY` | Web search credentials. |

Do not put tokens or API keys in project files or commit them. The Web UI token
is compared by the backend; put credentials in headers, not URLs.
