# Subagents

Subagents let the parent model delegate a self-contained task to a child with
its own context. RingKo treats every child as a **provider execution** and keeps
the parent-facing contract identical across backends:

- one durable catalog entry per child;
- one terminal result (`completed`, `failed` or `cancelled`);
- events and transcripts persisted in the parent session;
- run-scoped jobs for background execution and cancellation;
- optional continuation for providers that support follow-up turns.

## Providers

Providers are named and configured under `subagents.providers` in
`~/.ringko/settings.local.json` (or a `--config` file). An empty configuration
uses one in-process provider.

| Type | Continuable | Resume | Workspace tools | Notes |
| --- | --- | --- | --- | --- |
| `in-process` | yes | yes | yes | Durable child session; inherits the parent approval gate and `read` / `write` / `full` mode. |
| `openai` | yes | yes | yes | Durable child driven by the OpenAI Responses API or Chat Completions, with API-key or ChatGPT OAuth auth. |
| `claude-code` | yes | yes | no | Runs the Claude Code CLI with `stream-json`; continues with `--resume`. |
| `codex` | yes | yes | no | Runs the Codex CLI with JSONL `exec`; continues with `exec resume`. |
| `acp` | no | no | no | Runs an Agent Client Protocol agent in an isolated subprocess. |
| `command` | optional | optional | no | Generic line-protocol adapter for any CLI agent. |

```json
{
  "subagents": {
    "default": "in-process",
    "maxActive": 4,
    "maxPerRun": 8,
    "providers": [
      { "type": "in-process", "name": "in-process" },
      {
        "type": "openai",
        "name": "openai-responses",
        "model": "gpt-6.1-sol",
        "models": ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra"],
        "protocol": "responses",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      {
        "type": "openai",
        "name": "openai-chat",
        "model": "gpt-6.1-sol",
        "protocol": "chat",
        "baseURL": "https://api.openai.com/v1"
      },
      {
        "type": "openai",
        "name": "openai-oauth",
        "model": "gpt-6.1-terra",
        "protocol": "responses",
        "auth": "oauth",
        "oauthAccount": "you@example.com"
      },
      {
        "type": "claude-code",
        "name": "claude",
        "command": "claude",
        "permissionMode": "dontAsk"
      },
      {
        "type": "acp",
        "name": "acp",
        "command": "my-acp-agent",
        "args": ["--acp"],
        "permission": "reject"
      },
      {
        "type": "command",
        "name": "custom",
        "command": "my-agent",
        "args": ["--json"],
        "parser": "text"
      }
    ]
  }
}
```

### Generic command provider

`command` turns any CLI into a subagent. CLI-owned arguments may contain
`{cwd}`, `{model}`, `{sessionId}` and `{prompt}`. `{prompt}` is only allowed
with `promptDelivery: "arg"`; stdin delivery is the default and is required on
Windows for safe argument handling.

- `parser`: `text`, `claude-stream-json` or `codex-jsonl`.
- `resumeArgs`: argv used when continuing; include `{sessionId}`.
- `continuable` / `resume`: advertise follow-up support.
- `env`: explicit child environment entries layered over the parent.

### OpenAI transports

One `openai` provider supports both OpenAI API shapes over the same durable
child lifecycle (tools, approvals, follow-ups, cold resume):

- `protocol: "responses"` uses the Responses API. `auth: "api-key"` (default)
  uses `OPENAI_API_KEY`, `apiKeyEnv` or `apiKey`; `auth: "oauth"` uses the
  ChatGPT OAuth credentials managed by `ringko auth login`.
- Both OAuth2 login flows are accepted: the browser loopback/PKCE flow
  (`ringko auth login openai-oauth`) and the device-code flow
  (`ringko auth login openai-oauth --device`). The provider reads the saved
  credential; choose a non-default account with `oauthAccount`.
- `protocol: "chat"` uses Chat Completions through the OpenAI-compatible
  transport. It requires an API key and accepts any OpenAI-compatible
  `baseURL`; OAuth is not supported on this route.

`model` is the default model and `models` is the optional selection allowlist.
`temperature` and `maxOutputTokens` apply to every request. The child still
runs in-process, so workspace tools and the parent approval gate are unchanged;
only the model transport differs.

## Tools

`task` starts a child:

| Field | Meaning |
| --- | --- |
| `description` | Short label (up to 120 characters). |
| `prompt` | Self-contained task (up to 16,384 characters). |
| `mode` | `read`, `write` or `full`; external providers ignore it. |
| `provider` | Configured provider name; defaults to `subagents.default`. |
| `model` | Configured model id; requires provider `modelSelection`. |
| `cwd` | Child working directory; defaults to the workspace. |
| `background` | Return a job id and notify the parent when the first turn settles. |

`task_control` manages existing children:

- `list` returns the parent-owned catalog, including interrupted historical
  children and resumable provider sessions.
- `status` returns one catalog entry.
- `send` adds a follow-up turn to a continuable child, cold-resuming a persisted
  in-process or CLI child when the previous run has ended.
- `interrupt` cancels the current turn but keeps the child available.

`background` tasks run under the normal `JobManager`; `job cancel` and
`POST /api/sessions/:id/task-cancel` stop the execution and persist a
`cancelled` result.

## Persistence and cold resume

The parent session records:

- `task/started` with provider, mode, model, directory, resumability and the
  child session id;
- `task/event` for in-process agent activity;
- `task/message` for user/follow-up and assistant text;
- `task/status` for each turn of a continuable child;
- `task/completed`, `task/failed` or `task/cancelled` with the terminal result.

In-process children receive their own session file with
`parentSession` metadata. `task_control send` reopens that session after a
restart, so the child keeps its transcript and tool history. External providers
store the native session/thread id in the catalog entry and resume through their
own CLI protocol. A child whose final event is missing (a crash) stays
`unknown`, never `running`, when the parent is viewed later.

## Security

- In-process children receive a restricted capability view and dispatch every
  tool call through the parent registry. Approvals, permission rules, sandbox
  policy and tool hooks therefore stay in one place.
- `read` mode sees read-only tools; `write` additionally sees write tools with
  workspace writes auto-approved; `full` inherits the parent's full access. All
  modes exclude delegation and job-control tools, so a child cannot recurse.
- A task with an external provider, or a working directory outside the
  workspace, is classified as a gated operation before it starts.
- External providers are configured by the user. Their argv comes from
  configuration, not model input; task prompts are delivered on stdin by
  default.
- Provider results are bounded (32,768 characters) and diagnostics never include
  raw stderr, environment values or credentials.

## Limits

- `maxActive` caps live children per manager; `maxPerRun` caps launches per run.
- A background child blocks the run until its first turn settles so the parent
  can receive the result; it is not a cross-run daemon.
- Cold resume requires the provider to be configured and the session/thread id
  to still exist.
- ACP children execute once and cannot receive follow-ups.
