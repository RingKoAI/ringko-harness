# Providers

Providers are introduced **through configuration** and built at run time, so
provider code (and the AI SDK) is never compiled into the `ringko` binary. Only
the offline `echo` provider ships in the binary.

`provider.json` **defines** the provider by type plus its fields — it does not
reference an external file.

Credentials live in `~/.ringko/auth/auth.json` (mode `0600`), one entry per
provider. There are two credential types: `oauth` (OAuth2 login) and `apikey`
(a preset provider's API key). An `apiKey` may still be set inline in
`provider.json`, but `auth.json` wins when both are present. Never commit either
file.

```jsonc
{
  "openai":   { "type": "oauth",  "refresh": "…", "access": "…", "expires": 0, "accountId": "…" },
  "gateway":  { "type": "apikey", "key": "…" }
}
```

## Files (under `~/.ringko`)

| File | Contents |
| --- | --- |
| `provider.json` | the provider definition (`{ "provider": { ... } }`) |
| `settings.local.json` | workspace, capabilities |
| `.mcp.json` | MCP servers |
| `skills/`, `sessions/` | skills and session logs |

`RINGKO_HOME` overrides the home directory; `--config <path>` overrides the file.

## Defining a provider

`type` selects the provider; the remaining fields complete it.

```json
{
  "provider": {
    "type": "openai-compatible",
    "baseURL": "https://<your-gateway>/v1",
    "apiKey": "<key>",
    "model": "<model-id>"
  }
}
```

Supported types (aliases in parentheses):

| type | fields | credential |
| --- | --- | --- |
| `openai` | `model` | `OPENAI_API_KEY` |
| `openai-oauth` (`oauth`, `chatgpt`) | `model` | ChatGPT OAuth (`~/.ringko/auth/auth.json`) |
| `github-copilot` (`copilot`) | `model` | GitHub Copilot device login (`~/.ringko/auth/auth.json`) |
| `anthropic` | `model` | `ANTHROPIC_API_KEY` |
| `google` (`gemini`) | `model` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `openai-compatible` (`customendpoint`, `compatible`) | `baseURL`, `model`, `apiKey?` | `apiKey` |

`url` (a full `.../chat/completions` URL) is accepted and converted to `baseURL`.

## OAuth (ChatGPT)

`openai-oauth` reuses the Codex backend with a token-injecting fetch, so no API
key is needed. Tokens live in `~/.ringko/auth/auth.json` (mode `0600`) and are
refreshed automatically before they expire.

```sh
ringko auth login openai            # browser loopback on localhost:1455 (PKCE)
ringko auth login openai --device   # headless device-code flow
ringko auth status                  # list stored credentials (never prints tokens)
ringko auth set gateway <api-key>   # store an API key for a preset provider
ringko auth logout openai
```

In the REPL: `/login` opens a provider/method menu (OpenAI browser/headless, GitHub
Copilot device). While signing in, a dialog shows the URL and device code — press
`c` to copy it to the clipboard.

`github-copilot` uses the GitHub device flow (`ringko auth login github-copilot`);
its long-lived token is sent to `https://api.githubcopilot.com`.

If OpenAI/`auth.openai.com` is blocked in your region, set `RINGKO_PROXY`
(e.g. `http://127.0.0.1:7890`) before running; it is propagated to all requests.

## Model catalog

After `ringko auth login`, models are discovered live (`/models`) when the
provider exposes them, and written to `provider.json`. For providers without a
models endpoint (e.g. ChatGPT OAuth), the bundled catalog is used.

The catalog is data, not code:

| File | Role |
| --- | --- |
| `packages/config/models.json` | hand-curated overrides (win when non-empty) |
| `packages/config/models.dev.json` | generated snapshot, refreshed daily by CI |

```sh
RINGKO_MODELS_URL=https://models.ringkoai.com/catalog.json \
  pnpm --filter @ringko-ai/config refresh:models
```

`RINGKO_MODELS_URL` sets the source (defaults to models.dev); point it at our own
mirror endpoint once it is live.

## CLI

```sh
ringko config set provider.type openai-compatible
ringko config set provider.baseURL https://<your-gateway>/v1
ringko config set provider.apiKey <key>
ringko config set provider.model <model-id>
```

## In the REPL

```
/connect base <baseURL> <apiKey> <model>   # openai-compatible endpoint
/connect openai <model>
/connect anthropic <model>
```

`/connect` rebuilds the model live and persists the provider to
`~/.ringko/provider.json`.
