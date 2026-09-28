# Harness tool layer

The harness provides a provider-neutral tool registry. It is not an MCP server and
does not expose filesystem, network, or shell capabilities by itself.

## Execution boundary

Every invocation passes through this sequence:

1. Parse and validate untrusted input with the tool's `parseInput`.
2. Assess the operation using trusted tool implementation logic.
3. Pass the risk assessment through the central access policy.
4. Request approval for medium- or high-risk operations.
5. Execute only after the policy allows the call and any required approval is granted.

Missing approval handlers and rejected requests fail closed. Tool code is registered
by the host application; model-generated tool input cannot choose its own risk
classification or call an implementation outside the registry.

`Agent.onEvent` emits `model` after a valid model response, `tool_call` just
before each requested tool enters the registry, and `tool` or `tool_error` after it
settles. A host that persists events can use `tool_call` as a write barrier:
if its handler fails, that tool body is not entered.

## Risk policy

| Operation | Default classification | Approval |
| --- | --- | --- |
| Safe operation | `safe` / `none` | No |
| Workspace file read | `workspace_file` / `low` | No |
| Workspace write | `workspace_write` / `low` | Only if assessed as medium/high |
| External file operation | `external_file` / `high` | Yes |
| Outbound network request | `network` / `medium` | Yes |
| Shell or command execution | `shell` / `high` | Yes |

Tool implementations must resolve paths and classify external targets themselves;
the registry does not treat a caller-provided path as proof that it is inside the
workspace.

## Registering a tool

Each tool provides a JSON-Schema-compatible object input schema, a runtime parser,
a risk assessor, and an executor. The host supplies an approval handler when
dispatching a call:

```ts
registry.register({
  name: "read_workspace_file",
  description: "Read a file from the current workspace.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  parseInput: parseReadInput,
  assessRisk: ({ path }) => ({
    kind: "workspace_file",
    reason: "Read a workspace file.",
    target: path,
  }),
  execute: readWorkspaceFile,
});

const result = await registry.call("read_workspace_file", input, requestApproval);
```

Wrap definitions with `defineTool` to validate and freeze them where they are
written, so a malformed tool fails at author time instead of at first call:

```ts
import { defineTool } from "@ringko-ai/harness";

const readTool = defineTool({ /* the same fields as above */ });
```

`registry.register` runs the same validation at the boundary, and
`registry.registerAll([...])` registers a bundle atomically: if any definition is
invalid or collides, none are added. The registry only ever exposes metadata
(`list`, `get`, `has`, `names`, `size`); executors stay behind `call`, so model
output can never reach an implementation that was not registered.

The registry's `list()` metadata and `call()` dispatcher are intended integration
points for a future MCP adapter. The adapter must preserve the same approval gate
and must not expose tool executors directly.
