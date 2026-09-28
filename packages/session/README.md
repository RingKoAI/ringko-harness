# @ringko-ai/session

Event-sourced session storage, following the model used by DeepSeek Harness: one
**append-only JSONL log per session** is the source of truth, and conversation
history is derived from it.

## Layout

```
<root>/--<normalized-cwd>--/<encoded-id>/session.jsonl
                                        session.lock
```

`root` defaults to `~/.ringko/sessions`. The first line is a header
(`{ type: "session", id, version, createdAt, cwd?, parentSession? }`); every
later line is an event (`{ type, seq, time, data?, ignorable? }`) with a
monotonic, contiguous `seq`.

## Properties

- **Lazy materialization**: `create()` writes nothing until the first
  append/flush.
- **Single writer**: `open(id, "write")` takes a cross-process lock; a live
  writer rejects a second one, a stale lock from a dead pid is reclaimed.
- **Immutable**: committed events are never rewritten; readers **fail closed** on
  a newer format version or non-contiguous `seq`.
- **Torn-tail tolerant**: an interrupted final line is ignored.
- **`ignorable`**: forward-compatibility marker for events a reader may skip.

## API

```ts
import { SessionStore } from "@ringko-ai/session";

const store = new SessionStore(); // root = ~/.ringko/sessions
const session = store.create();
session.appendEvent("user/message", { content: "hi" });
session.flush();
session.close();

for (const meta of store.list()) console.log(meta.id, meta.header.createdAt);
```

`@ringko-ai/sdk` records a conversation to a session when one is passed to
`createRingKo({ session })`; `ringko session list` shows stored sessions.

## Tool call recovery

The SDK flushes `assistant/message` after a model response, then flushes a
separate `tool/call` immediately before each tool can execute. It flushes
`tool/result` after the tool settles. The assistant event retains the model's
complete call list for conversation replay; `tool/call` is an audit event and
does not add a second assistant message.

When a write session is resumed, the SDK appends a failed `tool/result` for
each assistant call without a recorded result, including calls in older logs
without `tool/call`. The result says the outcome is unknown: a prior process
may have completed an external side effect before it stopped. Recovery never
reruns the tool. The repair is flushed before the next user prompt or tool run.

This log does not yet retain complete model request snapshots, streamed model
attempts, or explicit turn and step boundaries.
