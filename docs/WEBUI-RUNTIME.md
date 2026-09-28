# WebUI runtime and workspace review

## Implemented

- Every conversation owns its messages, transient response, approvals, questions,
  todos, child tasks, jobs, draft and ordered input queue. Changing the visible
  route does not stop another conversation or redirect its callbacks.
- AI SDK text and reasoning deltas stream through the harness/SDK and SSE. Only
  completed assistant turns enter durable history. Transient chunks do not become
  synthetic user messages. Final responses replace their transient previews.
- Running sessions accept up to 16 queued messages. Items can be edited or removed.
  They run sequentially after the complete current task, including background job
  continuations. Failure or Stop pauses pending items; Resume starts them again.
- Stop invalidates that conversation's run token before aborting its stream. Late
  callbacks cannot update a new run. Other sessions are not aborted.
- Child task details replay the recorded child model messages and tool calls/results
  through a session-scoped, cursor-paged endpoint. Polling runs only while the
  detail is open and the task remains active (100 events/page, 1000 displayed).
- Files & changes provides read-only directory/file previews and Git diff against
  HEAD. It covers the active server workspace; it does not attribute changes to an
  individual task. New/untracked files can be previewed but are not in HEAD diff.

## API boundaries

- `POST /api/chat`: bounded message/attachment input; an overlapping run in the
  same session returns 409; at most eight concurrent sessions are accepted.
- `GET /api/sessions/:id/task-detail?taskId=...&after=-1`: the task must belong to
  the requested session. Completed historical tasks remain readable.
- `GET /api/workspace/files?path=...`, `/file?path=...`, `/diff?path=...`: paths
  are workspace-relative. Protocol decoding occurs once in URL parsing. Absolute
  paths, NUL, parent components and links are rejected. Canonical component-aware
  containment is checked. Listings and text previews are bounded; binary content
  is not rendered. Git receives an argument array, disables external diff/textconv
  and fsmonitor, has an output limit and a deadline.
- These endpoints use the server's existing authentication policy. Model text,
  task results and file content are treated as untrusted display data.

## Verification and limits

Regression coverage includes cross-session isolation, stale-history rejection,
late callbacks, queue ordering/edit/remove/stop, incremental text/reasoning,
overlapping-run rejection, task ownership/authentication, malformed chat input,
file bounds, binary previews and Windows junction traversal. Browser checks cover
two simultaneous sessions, queued continuation, task details and a real Git diff.

The queue and unsent drafts currently live in the browser tab's memory. Refreshing
or closing the tab discards pending inputs and interrupts its live streams. This
is not a reconnectable background daemon. Stream interruption is reported instead
of declaring a task successful.

The filesystem viewer is not an OS sandbox. Descriptor-relative traversal is not
available through the portable Node APIs here; a hostile local process replacing
an ancestor after validation remains outside the confinement guarantee. No file
write API was added. Git inspection runs only against a trusted local workspace.

Further work: mid-turn steering at an agent step boundary, durable/reconnectable
input queues, richer turn grouping/virtualized trajectory, plan review, deliverable
attribution and goal/schedule management UI.
