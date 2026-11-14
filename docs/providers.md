# Providers

Providers and model selection are defined in `~/.ringko/provider.json`:

```json
{
  "model": "DeepSeek/deepseek-chat",
  "small_model": "DeepSeek/deepseek-chat",
  "providers": [
    {
      "name": "DeepSeek",
      "type": "openai-compatible",
      "baseURL": "https://api.deepseek.com/v1",
      "models": [
        { "id": "deepseek-chat", "name": "DeepSeek Chat", "toolCalling": true },
        { "id": "deepseek-reasoner", "name": "DeepSeek Reasoner", "thinking": true }
      ]
    }
  ]
}
```

`model` uses `<provider name>/<model id>`. If it does not match, the first
provider and its first model are used. `small_model` is optional and is used for
compaction and session metadata.

## Provider types

| `type` | Transport |
| --- | --- |
| `openai` | OpenAI API |
| `anthropic` | Anthropic Messages API |
| `google` | Google Generative AI |
| `openai-compatible` | Any OpenAI-compatible chat-completions endpoint; `baseURL` is required |
| `opencode-go` | OpenCode Go through its documented Chat Completions compatibility API |
| `openai-oauth` | OpenAI through an OAuth account |
| `anthropic-oauth` | Anthropic through an OAuth account |
| `github-copilot` | GitHub Copilot |
| `xai-oauth` | xAI through an OAuth account |
| `echo` | Offline deterministic provider used by tests and first-run setups |

`type` is required for hosted providers; omitting it selects the offline `echo`
provider. Common aliases such as `gemini`, `grok`, `copilot`, `chatgpt` and
`compatible` are mapped to their canonical types. Aliases live in the runtime
provider modules and are registered by `packages/providers/src/registry.ts`.

### Source layout

Each preset has its own `packages/config/src/providers/<id>.ts`, owning its name,
endpoint, environment variable, search aliases and credential requirements.
`presets.ts` explicitly registers these modules. Runtime adapters live in
`packages/providers/src/<type>.ts` and own model construction, discovery,
authentication and transport settings; `registry.ts` and `index.ts` dispatch them.
OpenCode Go uses its own `opencode-go.ts`; DeepSeek's preset lives in
`config/src/providers/deepseek.ts` and reuses the OpenAI-compatible transport.

## Custom endpoints

### Configure from the terminal

Run `/connect` without arguments, type a provider name or ID, and press Enter.
Exact names and aliases rank first: `opencodego` or `go` selects OpenCode Go.
`/connect opencode-go` also opens setup directly. Quick setup uses the preset's
name and endpoint: paste the API key and press Enter to discover models, then type
a model name or ID and press Enter to use it. No arrow keys are needed.

Keys are masked; leaving the field empty keeps saved/environment credentials.
Custom providers ask for the base URL first. Press Tab to edit all defaults,
including the provider name, endpoint and comma-separated model IDs; Enter then
advances through the fields. Supplying model IDs skips discovery. Ctrl+S saves
directly and Esc cancels. Typing a configured provider's name reopens its settings;
`/model` remains available for model switching. Failures preserve the form. Keys
are saved separately in the user's `auth/auth.json`, outside chat history and
project configuration. With `--config`, provider settings go to that file.

### OpenCode Go

Subscribe and obtain a key in the [OpenCode Console](https://opencode.ai/console),
then use `/connect opencode-go`. Alternatively set `OPENCODE_API_KEY` and leave
the key field blank. The default base URL is
`https://opencode.ai/inference/go/openai/v1`; discovery reads the public
`https://opencode.ai/inference/go/v1/models` directory without sending credentials.

```json
{
  "name": "opencode-go",
  "type": "opencode-go",
  "models": [{ "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" }]
}
```

Go officially translates every text model to Chat Completions. RingKo uses that
compatibility API for DeepSeek, Kimi, GLM, Claude, Gemini, GPT and other Go models,
without inferring native protocols from names. Requests carry RingKo's user agent
and a stable, hashed `x-opencode-session`; conversation identity is transport-only
and never enters model messages. Account permissions and Go quotas still apply.
See the [official Go documentation](https://opencode.ai/docs/go/).

### Custom OpenAI-compatible APIs

```json
{
  "name": "Local",
  "type": "openai-compatible",
  "baseURL": "http://127.0.0.1:8000/v1",
  "apiKey": "local",
  "models": [{ "id": "my-model", "name": "My Model" }]
}
```

`baseURL` points at the API root, not the chat-completions path. A model entry
may instead set `url` to a full chat-completions URL; RingKo derives the base
URL from it. For a provider that needs a custom module, set `module` to the
package that exports `createProviderClient`; it is imported at run time. The
built-in provider module ships with the CLI.

## Credentials

Credentials are read from the provider's `apiKey`, or from
`~/.ringko/auth/auth.json` using the provider's `name`:

```sh
ringko auth set DeepSeek sk-...
ringko auth status
ringko auth logout DeepSeek
```

OAuth providers use `ringko auth login`:

```sh
ringko auth login openai-oauth
ringko auth login github-copilot
ringko auth login anthropic-oauth
ringko auth login xai-oauth
```

`ringko auth login openai-oauth --device` uses the device-code flow. OAuth
accounts are grouped by domain; `ringko auth default <domain> <account-id>`
selects one when several are stored. Never commit API keys, tokens or endpoint
URLs that contain credentials.

The built-in OpenAI and Anthropic providers also read `OPENAI_API_KEY` and
`ANTHROPIC_API_KEY` through the AI SDK when no key is configured in RingKo.

## Models and limits

A model entry accepts:

| Field | Meaning |
| --- | --- |
| `id` | Model id sent in requests. Required. |
| `name` | Display name in the TUI and Web UI. |
| `thinking` | Whether the model supports reasoning. |
| `vision` | Whether the model accepts images. |
| `toolCalling` | Whether the model supports tool calls. |
| `contextWindow` | Total context window. |
| `maxInputTokens` | Input-only cap. |
| `maxOutputTokens` | Output cap and reservation override. |
| `catalogId` | Exact Models.dev mapping, `provider/model-id`. |
| `url` | Per-model chat-completions URL. |

In Web UI **Settings → Providers & models**, every model exposes context-window,
input/output token limits and an optional catalog mapping, including OAuth models.
Blank fields or **Restore automatic** remove manual capacity overrides; **Save**
applies changes to subsequent runs. **View automatic limits** reads RingKo's catalog
metadata without probing provider endpoints or sending provider credentials.
The UI distinguishes catalog output ceilings from automatic output reservations.
Values must be positive safe integers; explicit input/output caps cannot exceed an
explicit context window. Overrides do not increase a provider's actual capacity.
With `--config`, the editor reads and saves that file; otherwise it saves
`provider.json`. Fetching model lists preserves existing model limits and metadata.

Explicit `contextWindow`, `maxInputTokens` and `maxOutputTokens` override
catalog values. The total window and input-only cap are separate. When no
values are available, RingKo uses a 128,000-token working window and reserves
4,096 output tokens. A catalog output ceiling does not automatically become the
reservation.

Missing limits are filled from [Models.dev](https://models.dev/api.json). RingKo
matches by provider endpoint or identity, exact model id, and unambiguous
canonical id. `catalogId` is the deterministic option for aliases. Models served
from loopback or other local hosts are not looked up unless `catalogId` is set.
Automatic values are never written back to `provider.json` or added to model
prompts.

The catalog is cached at `~/.ringko/cache/models-<source-hash>.json`, with a
bundled offline snapshot as fallback. The cache is valid for one hour; a failed
refresh retries after five minutes and keeps the previous data. Set
`RINGKO_MODELS_URL` to use a compatible mirror. Remote mirrors require HTTPS;
HTTP is accepted only for loopback. Provider credentials are never sent to the
catalog URL.

## Thinking fields

`thinking` is one of `off`, `low`, `high` or `max`. Each provider receives it in
its own shape:

| Provider | Request field |
| --- | --- |
| Anthropic | `thinking` and `effort`; older models use a token budget |
| Google 2.5 | `thinkingConfig.thinkingBudget` |
| Google 3 | `thinkingConfig.thinkingLevel` |
| OpenAI | `reasoningEffort` |
| OpenAI-compatible, xAI, Copilot | The matching provider-options key with `reasoningEffort` |

Assistant reasoning is replayed only in the form the active provider accepts:
signed thinking for Anthropic, thought signatures for Google, provider items for
OpenAI, and reasoning content for compatible endpoints. When the provider
changes, foreign reasoning is dropped instead of being relabelled.

## Discovery

```sh
ringko models                 # discover the configured provider's models
ringko models DeepSeek        # discover a named provider
```

Discovery saves new model ids into the provider entry without removing existing
ones. The model picker in the TUI and Web UI reads the same configuration.
