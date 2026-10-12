# Shared backend

## Structure and ownership

```text
TUI (repl) ---- client/protocol ---- app backend ---- sdk/runtime/providers
WebUI -------- client/protocol ---- services/{sync,runs} ---- session JSONL
```

The connected TUI never creates a local agent or session writer. The backend
owns execution, approvals and persistence. Existing embedded REPL/SDK hosts and
non-interactive CLI `run`/`loop` retain standalone behavior for compatibility.
This change does not migrate VS Code or introduce cross-device access.

The canonical workspace and optional config path determine a stable local port.
The first client spawns the service; binding selects the winner of concurrent
starts. Clients verify protocol, workspace and config identity before reuse.
A port collision fails with an actionable error; use an explicit local address.
Shared services are pinned to their launch workspace and reject project switching.
Services remain alive until explicitly stopped; the OS/service restart interrupts
in-flight work (there is no durable model-request replay).

## Synchronization

- `GET /api/backend`: instance, protocol version, workspace and config identity.
- `GET /api/sync`: bounded SSE invalidations plus heartbeat, automatic reconnect.
- `GET /api/sessions/:id/snapshot`: authoritative transcript/events, partial
  output, active approvals/questions, tasks/jobs/todos and busy state.
- `POST /api/runs`: starts an independent run and returns HTTP 202.
- `POST /api/sessions/:id/stop`: explicit cancellation.
- `POST /api/backend/stop`: stops an idle service.

Reconnection always fetches fresh snapshots, rather than replaying an unbounded
event history. Snapshot requests are coalesced, at most one in flight per session
subscription. Revision/instance checks reject stale state. WebUI keeps local
drafts/queues; snapshots are not double-applied during its own chat stream.
Legacy `/api/chat` streaming remains supported, but disconnect no longer aborts.

## Development

Run `pnpm dev:tui` from the repository root. Open the printed URL to use built
WebUI assets (`pnpm --filter @ringko-ai/webui build`). For Vite hot reload,
start `pnpm dev` first; both dev surfaces use the repository workspace's shared
port. An already running non-dev service must be stopped before starting `pnpm dev`.
`RINGKO_API` overrides Vite's API proxy target when using an explicit backend port.

## Security and fault handling

Scope: changed HTTP/SSE entry points, workspace identity, run ownership and session
writer cleanup. Assets include provider credentials, session contents and shell/file
capabilities. Same-user local processes are trusted; shared services only bind
loopback. API host/origin checks reject unrelated browser origins and rebinding.
Optional bearer authentication uses the existing `RINGKO_WEB_TOKEN` mechanism.
This is not protection against malicious processes running as the same user.

Input sizes, SSE buffers/subscribers, partial output and concurrent runs are bounded.
Only one active writer may mutate a session; deletion also acquires the writer lock.
Persistence failures fail closed and release locks/descriptors; failures are reported
in diagnostics. Isolated descriptor fault injection tests verify cleanup. A run's
workspace is captured before asynchronous provider resolution and revalidated before
ownership. Approvals may be settled exactly once, whichever client responds first.

Regression coverage includes two-client synchronization, late approval attachment,
disconnect survival, concurrent submissions/deletion rejection, authorization,
origin/workspace/malformed-ID checks, bounded SSE decoding, TUI-only backend execution,
stale snapshots, local-draft preservation and manually paused queues.
No production/third-party attack testing was performed; this is not a repository-wide
security certification or a full dependency audit.

## Known limitations

- Windows Bun 1.4.2 compiled-service smoke testing currently fails with `EPERM`
  when creating session directories; the same source-mode CLI succeeds. Compiling
  the executable alone does not verify deployment readiness. Use source mode for now.
- Standalone distribution includes a `webui` sidecar, not just the executable.
  Interactive browser PTY needs the existing Node.js/node-pty bridge installation.
- Vite still reports large pre-existing syntax/diagram/UI chunks during build.
- Port identity excludes `RINGKO_HOME` and authentication token; processes sharing
  a workspace/config must also use the same home/token, or connect explicitly.
- Full snapshots scale with session history; large logs can make synchronization
  expensive. Delta/paged snapshot transport is not included in this change.
