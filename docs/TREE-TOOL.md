# Native directory tree tool

`tree` is a built-in, read-only workspace tool. It enumerates directory metadata
with Node/Bun filesystem APIs; it never launches a shell, `tree`, `tree.com`, or
another system executable. The model should use `tree` for directory structure.
It is available to main agents and read/write delegated tasks without enabling
the shell capability.

## Inputs

```json
{ "path": ".", "max_depth": 3, "max_entries": 500 }
```

| Field | Default | Meaning |
| --- | --- | --- |
| `path` | `.` | Workspace-relative or absolute directory |
| `max_depth` | `3` | Maximum entry depth, from 0 (root only) to 16 |
| `max_entries` | `500` | Maximum emitted entries, from 1 to 2000; root excluded |
| `directories_only` | `false` | Show directories and symlinks, omitting ordinary files |
| `include_hidden` | `false` | Include names beginning with a dot |
| `exclude` | Built-in list | Exact child names to omit; a supplied array replaces the defaults |

Default exclusions: `.git`, `node_modules`, `dist`, `build`, `coverage`, `target`,
`.next`, `.cache`, `.venv`, `venv`, `__pycache__`. Exclusions apply to children:
an explicitly selected root can still be inspected. Use `exclude: []` to disable
the default exclusions. This is not a `.gitignore` parser or glob filter.

Entries are sorted directories-first and then by name, independent of locale.
Returned paths are relative to the selected root. The `tree` string contains
Unicode branch lines; filenames are escaped so control characters cannot forge
additional rows. No file contents are read.

## Results and limits

The result contains `path`, `tree`, a flat `entries` list (path, type and depth),
counts `directories`, `files`, `symlinks`, `other`, and `truncated`.
An empty directory returns just its root label and no entries.

Truncation is explicit through `truncation_reasons`:

- `max_depth`: directory children were not inspected beyond the depth bound.
- `max_entries`: the emitted-entry bound was reached.
- `scan_limit`: at most 20,000 directory entries may be inspected per call,
  including hidden/excluded names.
- `output_limit`: the 128 Ki-character preview/metadata budget was reached.
- `io_error`: a child disappeared, became unreadable, or changed during traversal.

Unreadable/changed child branches have an `error` code and are not silently
reported as complete. Root read errors fail the call. Cancellation propagates
instead of returning a successful-looking partial result.

## Boundaries and symlinks

The selected root is canonicalized before risk assessment. Roots outside the
workspace require the normal external-file authorization, including workspace
junctions that point outside. Execution rechecks the assessed root. Descendant
symlinks/junctions are marked but never recursively followed, preventing cycles.
Each opened directory's canonical path and identity are checked around reading;
detected replacement stops that branch. Node's portable API does not expose
descriptor-relative directory traversal, so these checks are not a claim of
complete isolation from an adversary concurrently replacing filesystem paths.

The tool is registered by `registerWorkspaceTools`. It uses `taskAccess: "read"`
and follows existing workflow allow/deny and permission rules. TUI exploration
groups include `tree`; expanded output shows its formatted tree rather than the
JSON metadata envelope.
