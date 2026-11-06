# Unreleased

- Rename the `ringko serve` command to `ringko web`. It still starts (or reuses)
  the per-workspace backend and prints the browser URL; `--port`, `--shared`,
  and `service start|status|stop` are unchanged.
- Resolve read, grep and glob targets through the filesystem before classifying
  them, so a workspace link that points outside needs approval and is rejected
  if it moves between approval and execution. Directory searches no longer
  follow or read symlinked entries. Deny and ask rules match both the caller's
  spelling and the resolved target; allow rules only match the resolved target.
- Add `offset` and `next_offset` to grep; report `truncated` only when another
  page really exists.
- Report a delegated task cancelled through its job as `cancelled` instead of
  blaming the parent run, and keep interrupted tasks/jobs from an earlier run
  marked unknown while a later run is active.
- Add a named subagent provider registry with durable in-process children,
  Claude Code and Codex CLI backends (native session resume), an ACP backend,
  and a generic command adapter. Add `task_control` for follow-ups, status,
  listing and interruption; `task` accepts `provider` and `cwd`.
- Add an `openai` subagent provider that supports both OpenAI transports
  (Responses API and Chat Completions) with API-key or ChatGPT OAuth auth,
  model allowlists, custom base URLs and OAuth account selection. Both OAuth2
  login flows accepted by `ringko auth login openai-oauth` (browser loopback
  and `--device`) work through the same stored credential.
- Move pnpm overrides to `pnpm-workspace.yaml` and update the project package
  manager to pnpm 12.
- Update the curated OpenAI OAuth model list through GPT-6.1 Terra/Sol and use
  current Models.dev ids in the OpenAI subagent examples.
- Settle every run with a stable run id and an explicit `run/completed`,
  `run/failed` or `run/cancelled` event. Persistence failures no longer prevent
  job/subagent cleanup or leave the agent stuck in a running state; cleanup
  failures are attached without replacing the primary error.
- Make agent, factory, runtime and supervisor close awaitable and
  failure-aggregating. `server.stop()` now stops admission, cancels runs, waits
  for settlement with a bounded timeout, then reports pending runs and release
  errors instead of silently returning.
- Show live `[*]` markers for busy sessions in the `/resume` picker and refresh
  the list on backend `session` sync notices while preserving the picker query
  and selection.
- Persist subagent catalogs, follow-up messages and per-turn status in the
  parent session. In-process children keep their own session transcript and
  cold-resume after a restart; external providers resume through their native
  session id.
- Require approval before starting an external provider or a child working
  directory outside the workspace.
