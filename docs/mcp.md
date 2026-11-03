# MCP servers

RingKo connects to MCP servers over stdio, Streamable HTTP or legacy SSE, and
registers their tools beside the built-in tools. MCP tools pass through the same
risk assessment and approval gate as everything else.

Configuration is read when the backend starts. Stop active sessions before
changing it; the Web UI refuses to save while a session is running, and a file
edited by hand needs a backend restart.

## Configuration files

| Scope | File |
| --- | --- |
| Project | `<project>/.mcp.json` |
| Project | `<project>/ringko.json` (`mcpServers` field) |
| User | `~/.ringko/.mcp.json` |
| Shared | `~/.agents/.mcp.json` |

The project root is the nearest ancestor containing `.git`, `.mcp.json`,
`ringko.json` or `.agents`. Files are merged in the order above, and the first
definition of a server name wins. A missing or empty file is skipped. Invalid
JSON, a non-object `mcpServers` field, or a non-object server definition is an
error, not a silent skip.

Each file has the same shape:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"]
    },
    "docs": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "X-API-Key": "replace-me" }
    },
    "legacy": {
      "type": "sse",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

## Transports

### stdio

A server with a non-empty `command` uses stdio. `args` is an array, `env` is an
object of string values, and `cwd` defaults to the workspace. `env` is merged
over the process environment. Values are passed literally: shell expansion is
not performed.

The child process runs inside the active sandbox policy. In `read-only` mode it
cannot write; in `workspace-write` it can write only where the sandbox allows.

### Streamable HTTP

A server with `url` and no `type` (or `type: "http"`) uses Streamable HTTP.
`headers` is an object of string values and is merged over any stored connector
credentials. The URL must be HTTP(S).

### SSE

Set `type: "sse"` to use the older HTTP+SSE transport. The rest of the
configuration is the same as Streamable HTTP.

## Managing servers

```sh
ringko mcp                                  # list configured servers
ringko mcp set docs '{"type":"http","url":"https://mcp.example.com/mcp"}'
ringko mcp remove docs
```

`ringko mcp set` and `ringko mcp remove` edit `~/.ringko/.mcp.json`. `ringko mcp`
prints the name, source (`project`, `ringko` or `agents`) and transport.

In the Web UI, open **Settings → Connectors**. The page edits project and global
servers separately, can test a connection, and shows connected servers and their
tool counts. Saving updates the configuration file and resets the workspace's
MCP connections.

## Authorization

Local stdio servers inherit the sandbox and need no separate grant.

Remote servers are withheld unless one of these is true:

- the active sandbox is `danger-full-access`, or
- `sandbox.mcp.<server name>` grants that exact endpoint.

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "mcp": {
      "docs": {
        "url": "https://mcp.example.com/mcp",
        "readOnlyTools": ["search", "get_page"],
        "allowedTools": ["create_page", "update_page"]
      }
    }
  }
}
```

`url` must match the normalized server URL exactly, including its path, with no
embedded credentials or fragment. The grant lists exact tool names:

- `read-only` mode exposes only `readOnlyTools`.
- `workspace-write` exposes `readOnlyTools` and `allowedTools`.
- `danger-full-access` exposes every tool the server lists.

Server-provided `readOnlyHint` annotations do not grant authority. Only host
configuration or the process boundary does.

Remote OAuth uses the authorization-code flow with PKCE and dynamic client
registration. In **Settings → Connectors**, start sign-in for a remote server and
complete it in the browser. Tokens are stored in `~/.ringko/tool.auth.json`
(mode 0600) and refreshed before expiry. A server that expects a static key can
use `headers` in its MCP configuration, or an entry in `tool.auth.json`:

```json
{
  "docs": { "type": "apikey", "key": "replace-me" }
}
```

An `apikey` entry is sent as `Authorization: Bearer <key>`. `type: "headers"`
stores a literal header map instead.

## Tool names and risk

A server's tools are exposed as `<server>__<tool>`. Characters outside
`[A-Za-z0-9_-]` become `_`; the server prefix is limited to 40 characters and
the final name to 128. If a name already exists, the later tool is skipped, so
built-in tools keep their names.

Every MCP tool is registered as a `network` risk call. It still goes through
the approval gate; `approval` mode asks every time, `assist` asks when the
assessment says so, and `full` does not ask.

## Runtime behavior

- Servers connect in parallel during backend startup. A slow server does not
  block the others; discovery waits up to 1.5 seconds for the startup pass.
- A failed server is retried twice (after 1 second, then 2 seconds). After three
  attempts, automatic retry stops. Errors are reported in the Web UI and in
  diagnostics; other servers keep working.
- Each JSON-RPC request times out after 30 seconds.
- A server may expose at most 512 tools over at most 32 pages.
- A single response or SSE event is limited to 1 MiB.
- Configuration is limited to 64 servers.
- Tools are re-registered before each run, so a server that reconnects becomes
  available without restarting the backend.
- `GET /api/mcp/connected` returns the current connections and errors without
  starting or reconnecting anything. It is read-only.

Tool text content is joined with newlines. Non-text content is serialized as
JSON. If the server returns `isError`, the call fails with the returned text.
