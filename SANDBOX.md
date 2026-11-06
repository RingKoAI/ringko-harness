# Sandbox boundaries

The sandbox limits host **writes** and process lifecycles. It is not a VM, a
secret vault, or a claim that every readable host file is isolated. The active
mode is independent of the tool approval mode: approval never removes an OS
sandbox boundary.

## Policy and authority

`workspace-write` is the default. `read-only` prohibits persistent writes and
permits private temporary storage. `workspace-write` additionally grants the
canonical workspace and `additionalWritableRoots`. `danger-full-access` must be
explicitly configured and bypasses confinement. Runner initialization failures
never select it automatically.

Assets protected by these boundaries include files outside writable roots,
ambient credential environment variables, launcher control handles, and child
process lifetimes. Model commands, repository files, tool arguments, MCP
metadata and subprocess output are untrusted. Host settings, the system native
compiler, installed dependencies and explicit connector credentials are trusted
configuration. Keep host settings and credentials outside model-writable roots;
granting the whole home directory also grants its configuration files.

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": [],
    "mcp": {
      "documentation": {
        "url": "https://mcp.example.com/docs",
        "readOnlyTools": ["search", "fetch"],
        "allowedTools": []
      }
    }
  }
}
```

Store this policy in `~/.ringko/settings.local.json`, or the explicitly selected
host configuration. Project `.mcp.json` selects transports but cannot authorize
remote tools. A remote grant binds both the server name and exact normalized
URL. An endpoint change is rejected before saved credentials are used. The
read-only list is usable in both confined modes; `allowedTools` is usable only
in `workspace-write`. These are explicit authorizations for remote effects,
not a claim that remote files belong to the local workspace. Tool approvals
still apply. `readOnlyHint`, names and descriptions are never proof of safety.
Cross-origin SSE endpoints and HTTP redirects are rejected rather than
forwarding connector headers to a different endpoint.

Local stdio servers run through the process runner and default to their
workspace directory when no `cwd` is configured. A local connection records
its actual sandbox mode; a writable or unconfined process cannot be reused as a
read-only connection. Restart `ringko web` after changing sandbox or remote
authorization settings so existing MCP processes use the new policy.

## Runners

### Windows

The embedded C# launcher is compiled into a content-addressed cache under
`~/.ringko/bin`. Source and executable are staged privately; only a successfully
built executable is installed. Windows PowerShell security modules are loaded
from the selected engine's system module directory, independently of a
PowerShell 7 caller. Windows requires the .NET Framework C# compiler; native
PTYs additionally require Windows 10 1809 or later with ConPTY support.

Processes receive a write-restricted primary token with disabled privileges,
Low integrity, per-root capability SIDs, and a private temp capability. The
launcher grants the workspace, extra roots and temp roots their corresponding
ACEs and Low labels. Labels are inheritable entries on each root rather than a
per-file traversal, so existing children and later files inherit them without
reopening every entry. Workspace grants/labels remain on those directories;
read-only tokens do not carry their SIDs, so a mode downgrade does not inherit
earlier write authority. Initialization or grant failures reject execution.
Executables built directly inside an already Low-labelled development tree can
inherit that label and launch at Low integrity even outside the runner. The
standalone smoke test recreates the executable in isolated temporary storage,
as archive extraction does; it never changes user directory ACLs to mask this.

Each child starts suspended, enters a kill-on-close Job Object, then resumes.
Pipe launches inherit only an explicit stdio handle list. PTYs are created by
the native host; an already-confined bootstrap reopens the assigned console,
drops inherited launcher pipes, and creates the target with the same token.
Input, resize, output and exit use bounded JSON-line control frames. Closing
the control stream or disposing the terminal terminates its job tree.

### Linux

Bubblewrap mounts the host root read-only, provides private PID/IPC namespaces,
a fresh `/dev`, a private `/proc`, and a per-invocation tmpfs at `/tmp`.
Workspace-write binds only the workspace and explicit extra roots writable.
Read-only workspaces under `/tmp` are rebound read-only after the tmpfs mount.
Namespace or mount failure is an execution failure, not an unsandboxed retry.

### macOS

Seatbelt denies filesystem writes except the canonical private temp directory,
`/dev/null`, and the workspace/extra roots granted by workspace-write. Ambient
`/tmp` and `/private/tmp` are not writable exceptions. Child processes inherit
the profile. `sandbox-exec` availability is a platform prerequisite and has no
ordinary-shell fallback.

## Execution and credentials

Shell tools, terminals, local stdio MCP, explicit embedded-REPL `!command`, and
workspace Git diffs use the runner. Direct write/edit tools default to the same
workspace boundary; full host writes require an explicit full-access policy.
File target resolution follows existing aliases, checks nearest existing
parents for new files, and handles Windows long/8.3 directory identity aliases.

Confined processes omit ambient token/key/secret/password/auth/cookie variables
and credential-agent variables. Temporary environment paths point to isolated
storage. Explicit MCP `env` entries are authorized connector inputs and can
pass credentials by name; they are not printed into command lines. Reading
credential files is not prevented by this write-confinement design.

Loader injection variables (`LD_*`, `DYLD_*`, CLR profiler/AppDomain settings,
`NODE_OPTIONS`, and related loader overrides) are removed from the ambient
environment and rejected in connector `env`. They could otherwise execute code
inside the launcher before confinement. Set such variables within an
already-confined command if needed. Runner and Windows system-tool paths are
pinned before connector `PATH` is applied, and the Windows compiler cannot be
replaced with a project-provided `RINGKO_CSC` value.

## Verification and residual limits

Native Windows tests exercise read-only/workspace writes, outside writes and
deletes, extra roots and mode downgrades, child-process inheritance, ambient
environment filtering, timeout tree cleanup, and actual restricted ConPTY
I/O/resize. A standalone relocation test builds and runs a compiled binary in
an isolated directory with no helper source sidecar. MCP integration tests use
a real Node stdio server in both modes and check allowed and denied file
effects. POSIX native tests run only when their actual runner is usable;
unsupported tests are reported as skipped, not as successful native execution.

Run `pnpm test`, `pnpm typecheck`, `pnpm build:npm`, and `pnpm test:npm` for the
project checks. The CI matrix covers Windows, Ubuntu and macOS. Local execution
on one OS is not evidence that another OS's native tests passed.

Known residual limits:

- Host reads and network access remain available; no network or memory quota
  isolation is promised by these profiles.
- Windows restricted grandchildren using libuv named-pipe stdio can still fail
  with `EPERM`; inherited stdio and native ConPTY paths are supported.
- Filesystem aliases such as hard links can share an object across paths.
  Canonical-path checks in in-process file tools do not eliminate all TOCTOU
  races. Treat this as partial write confinement, not an absolute filesystem
  security boundary for hostile local users changing directories concurrently.
- Private temp directories are retained under system temporary storage;
  automatic reclamation of every inactive runtime directory is not complete.
- Missing compiler, bubblewrap, Seatbelt or required kernel features fail
  closed. Do not work around initialization failure with implicit full access.
- Windows confined writable roots must use local drive paths. UNC/device roots
  are rejected before ACL or network access rather than assuming that a remote
  filesystem implements the required token/mandatory-label semantics.
