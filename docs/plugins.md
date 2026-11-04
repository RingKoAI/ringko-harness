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
    "trusted": [
      { "id": "reviewer", "path": "C:\\Users\\me\\.ringko\\plugins\\reviewer" }
    ]
  }
}
```

Trust is bound to the resolved plugin directory, not just its name. Trust is
deliberately not read from a project file, so a cloned repository cannot enable
its own plugin. Legacy bare-id entries are accepted only for user-level roots
(`~/.ringko`, `~/.agents`); a project directory always requires a path-bound
entry. Remove an entry to disable the plugin. Untrusted directories are ignored
before their manifests are parsed.

`GET /api/plugins`, `RuntimeManager.plugins()` and `RuntimeContext.plugins()`
expose trusted plugin inventories and manifest errors without starting the
plugin. `POST /api/plugins/trust` and `/api/plugins/untrust` update the same
user-level trust list as the CLI. Runtime agents see plugin skills and MCP
servers through the normal tool and MCP registration paths.

Use `ringko plugins` to list discovered directories and their trust state,
`ringko plugins trust <id>` to validate and trust the selected directory, and
`ringko plugins untrust <id>` to disable it. The command records a path-bound
entry in the user-level settings file and preserves every other key.

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
  default is `skills` when that directory exists. Each entry may be one skill
  directory (containing `SKILL.md`) or a collection of skill directories.
  Plugin skills are namespaced as `<plugin-id>:<skill-name>`, so they cannot
  shadow an installed skill.
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
