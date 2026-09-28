# @ringko-ai/sdk

Stable public facade over `@ringko-ai/harness` for host applications, including
the TUI, Web UI, Code extension, and desktop app.

```ts
import { createRingKo } from "@ringko-ai/sdk";

const ringko = createRingKo({ model: myModelClient });
ringko.register(myTool);

const result = await ringko.run("Do the task.");
```

All tool invocations still pass through the harness approval gate. The SDK does
not bypass or relax the access policy; host applications supply the approval
handler.

With `createRingKo({ session })`, the SDK flushes each `tool/call` event before
dispatching that tool. On a resumed write session, it records unknown outcomes
for calls left without results by an interrupted process before continuing.
See the [session log](../session/README.md#tool-call-recovery) for the recovery
semantics.
