# Tasks, questions and background jobs

CLI, TUI and Web chat expose task, job, subscribe, ask, todowrite and todoread.
SDK hosts enable task with `createRingKo({ model, task: true })`; jobs are built in.
Hosts register file/session/shell/network tools according to their configured capabilities.

## Task models and permissions

```json
{
  "description": "Inspect OAuth callbacks",
  "prompt": "Read callback success and failure handling, then report findings.",
  "mode": "read",
  "model": "my-provider/my-model",
  "background": true
}
```

| Mode | Capabilities | Approval |
| --- | --- | --- |
| `read` | Host-marked read tools: read, glob, grep, todoread | Parent policy for external files |
| `write` | Read tools plus write/edit | Workspace writes automatically approved; external files keep parent policy |
| `full` | All parent-configured tools except task, job and subscribe | Full access; no tool approvals |

Full mode cannot enable shell/network capabilities absent from the parent registry.
There are no recursive tasks. Each child has independent history; include necessary
context in its prompt. The optional model must match a host-configured provider/model
ID. Omission uses the current parent model. Invalid selections fail without silently
choosing another provider. SDK hosts supply `taskModels` and `resolveTaskModel`; tool
arguments cannot supply provider endpoints or credentials. Events record the selected model.

## Background and subscriptions

Task and shell accept `background: true`, returning a session-local `jobId` immediately.
Jobs can also start in the foreground, then be detached through the Web task card or
TUI Ctrl+B while running. Independent background work overlaps parent work; file
write/edit assessments, approvals and execution share a workspace mutex. Approval
prompts are serialized across children and parent model continuations.

```json
{ "jobId": "returned-id", "after": -1, "waitMs": 30000 }
```

Call `subscribe` with that input to replay events or long poll. Events identify `sub`
or `shell`, carry sequence cursors and explicit truncation flags, and include subagent
progress or stdout/stderr. `missed` means older events fell out of bounded replay.
Call `job` with `action: "status" | "cancel" | "background"` to inspect the final
result, cancel a process/task or detach a running foreground job.

After the parent reaches a final response, the SDK waits for background completions
and resumes the parent model with recorded `session/notification` messages. Each
completion is delivered once; the model can inspect its result and continue working.
The overall chat run stays active until all jobs and resulting continuations finish.
This is an in-process session workflow, not a daemon that survives process shutdown.
Stopping the chat cancels children and shell process trees, then drains cleanup before
the session closes. Completed file writes are not rolled back.

Limits: 4 active jobs, 32 job launches per run, 200 replay events/job, 8,192 characters
per event, 163,840 characters per stored job result, and 30-second subscriptions.
Shell output is limited to 65,536 characters per channel and 200 output events; it
continues draining excess output. Shell runtime is at most 10 minutes. Child tasks
allow 2 concurrent runs, 8 launches, 10 model turns, a 2-minute deadline, 16,384 prompt
characters and 32,768 answer characters. Parent notifications allow 32 continuations.

## Ask and todo

`ask` supports up to 4 questions, 8 options/question, single/multiple selection and
custom answers. Parent and child questions share a FIFO queue. Invalid answers do
not close the request. Escape/cancel, timeout and the caller signal remove pending
questions. TUI uses Up/Down, Space for multiple selection, Tab for custom text and
Enter to submit. Noninteractive CLI calls fail explicitly; use TUI/Web to answer.

`todowrite` replaces the full plan with pending/in_progress/completed statuses;
`todoread` retrieves it. Hosts persist `session/todo` snapshots and restore them when
resuming. The list is updated only by recorded tool actions, not inferred completion.

## Events and HTTP

Logs include task lifecycle/child events, `job/sub/*`, `job/shell/*`, ask lifecycle,
todo snapshots and parent notifications. Web SSE subscribes to jobs/questions for the
active session; Web task cards show permission, model, outcome and background controls.
Historical unfinished work has unknown status. System notifications stay out of chat
display but remain in model history and trajectory.

Authenticated endpoints follow the server's configured token policy:

- `GET /api/sessions/:id/jobs`: current or recorded job summaries.
- `POST /api/sessions/:id/jobs`: job action object.
- `GET /api/sessions/:id/events?jobId=...&after=-1&waitMs=30000`: live event subscription.
- `POST /api/ask`: `{id, output:{answers:[...]}}` or `{id, cancel:true}`.
- `POST /api/sessions/:id/stop`: cancel the active run.

JSON requests are bounded to 1 MiB. Live job IDs are scoped to a single SDK/session
manager. Completed logs are replayable after restart; executing jobs are not restored.

## Verification and remaining boundaries

Tests cover model selection, read bypass attempts, automatic workspace approval,
external approval/rejection, full configured capabilities, conversion to background,
exactly-once parent continuation, bounded replay, cancellation, real shell process-tree
termination, nonzero exits, deadlines, failed persistence, questions, todo recovery and
authenticated HTTP/SSE integration. The provider adapter routes system context through
AI SDK instructions, verified with mocks and a local compatible HTTP provider.

The security review covers dispatch, permissions, shared-write concurrency, event and
HTTP input boundaries. Write/edit classify canonical targets and revalidate after
approval; a workspace junction into an external directory needs external approval.
This is capability isolation, not an OS sandbox. Descriptor-relative filesystem
operations are unavailable in the current implementation, so hostile local filesystem
replacement races remain outside its sandbox guarantees. Synchronous grep regexes
cannot be preempted by a deadline. Custom trusted tools must declare capabilities
accurately and cooperate with cancellation. No repository-wide security audit is claimed.
