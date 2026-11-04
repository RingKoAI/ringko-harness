# Plugins

A plugin is a directory with a `plugin.json` manifest. Manifests are
declarative: they can add skills, prompt commands and MCP servers, but they
cannot execute code. Programmatic extensions use the runtime contribution API
instead.

## Locations and trust

Plugins are discovered under these roots, in precedence order:

| Scope | Directory |
| --- | --- |
| Project | `<project>/.ringko/plugins/<id>` |
| Project | `<project>/.agents/plugins/<id>` |
| User | `~/.ringko/plugins/<id>` |
| Shared | `~/.agents/plugins/<id>` |

The project root is the nearest ancestor containing `.git`, `.mcp.json`,
`ringko.json` or `.agents`. The first plugin with a given id wins.

Nothing is loaded unless its directory name is listed in the **user-level**
`~/.ringko/settings.local.json`:

```json
{
  "plugins": {
    "trusted": ["reviewer"]
  }
}
```

Trust is deliberately not read from a project file, so a cloned repository
cannot enable its own plugin. Remove a name to disable the plugin. Untrusted
directories are ignored before their manifests are parsed.

## Manifest

```json
{
  "schemaVersion": 1,
  "name": "reviewer",
  "version": "1.0.0",
  "description": "Review helpers",
  "skills": ["skills"],
  "commands": [
    {
      "name": "review",
      "description": "Review a diff",
      "argumentHint": "path",
      "prompt": "Review the current diff. Focus on $ARGUMENTS."
    }
  ],
  "mcpServers": {
    "reviewer": { "command": "node", "args": ["server.js"] }
  }
}
```

- `name` is required and must equal the directory id.
- `schemaVersion` must be `1` when present. Unknown fields are rejected.
- `hooks` is not supported; use a runtime contribution instead.
- `skills` lists directories relative to the plugin root. Absolute paths,
  `..` segments and symlinks escaping the plugin directory are rejected. The
  default is `skills` when that directory exists.
- `commands` are prompt templates shown in the REPL. `$ARGUMENTS` or
  `{{args}}` is replaced with the text after the command; without a
  placeholder the argument is appended. Plugin commands cannot shadow
  built-in commands.
- `mcpServers` uses the same shape as `.mcp.json`. Explicit project or user MCP
  configuration wins on a name collision.

Limits: 128 plugins, a 256 KiB manifest, 64 commands per plugin, a 64 KiB
prompt, 64 skill directories and 64 MCP servers per plugin.

A trusted plugin with an invalid manifest contributes nothing. Paths are
validated before any file outside the plugin directory is read.
