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

Project-level files can also carry an `mcpServers` map; see
[MCP servers](mcp.md) for the exact lookup order.

## Access modes

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
