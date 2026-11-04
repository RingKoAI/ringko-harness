# Skills

A skill is a directory containing `SKILL.md`. The file starts with frontmatter
that names the skill and describes when to use it:

```markdown
---
name: reviewer
description: Review a diff for correctness and regressions.
---

Review the change, then report findings by severity.
```

The `skill` tool exposes installed skills to the model by name. Installing a
skill does not run it automatically; the model loads its instructions when the
task matches.

## Locations

| Scope | Directory |
| --- | --- |
| Project | `<project>/.ringko/skills`, `<project>/.agents/skills` |
| User | `~/.ringko/skills`, `~/.agents/skills` |
| Plugin | a trusted plugin's declared skill directories |

Project skills win over user skills with the same name; `~/.ringko` wins over
`~/.agents`. Plugin skills are lowest precedence.

## Installing from the REPL

```
/skill add ./path/to/skill-directory
```

The REPL asks whether to install into the global (`~/.ringko/skills`) or current
project (`<project>/.ringko/skills`) root. The source is validated first:

- `SKILL.md` must exist at the root and be at most 64 KiB.
- The name must be a single path segment; a missing frontmatter name falls back
  to the source directory name.
- Symbolic links, special files, more than 256 files, more than 8 MiB in total,
  and files larger than 4 MiB are rejected.
- An existing skill with the same name is never overwritten.

The copy is staged in a temporary directory and renamed into place, so a failed
install leaves nothing behind.

`/skills` browses installed skills. The Web UI settings panel can create and
remove global skills. Programmatic installation uses `installSkill` from
`@ringko-ai/config`.
