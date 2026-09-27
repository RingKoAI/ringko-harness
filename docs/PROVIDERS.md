# Providers

Providers are **introduced through configuration**, not compiled into the
`ringko` binary. The binary only ships the offline `echo` provider; the config
names a provider module that is imported at run time (and marked external at
build time), so provider code and the AI SDK never end up inside the binary.

Never commit real API keys or endpoint URLs. The examples below use
placeholders only.

## Config file

Configuration lives in the user's home directory at `~/.ringko/config` (JSON),
so keys never sit in a project tree. `--config <path>` overrides the file and
`RINGKO_HOME` overrides the home directory.

```json
{
  "workspace": ".",
  "provider": {
    "name": "echo"
  },
  "capabilities": {
    "network": false,
    "shell": false
  }
}
```

Manage it with the CLI (writes to `~/.ringko/config`):

```sh
ringko config path
ringko config set provider.name openai
ringko config set provider.model gpt-4o-mini
ringko config get provider.model
ringko config unset provider.model
```

`~/.ringko/config` is written with `0600` permissions on POSIX.

## Hosted providers (`@ringko-ai/providers`)

`name` selects a provider kind handled by the configured module
(`@ringko-ai/providers` by default): `openai`, `anthropic`, or
`openai-compatible`.

```json
{
  "provider": {
    "name": "openai",
    "model": "gpt-4o-mini"
  }
}
```

Credentials come from the environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).

## Custom OpenAI-compatible endpoint

```json
{
  "provider": {
    "name": "openai-compatible",
    "baseURL": "https://<your-gateway>/v1",
    "apiKey": "<your-key>",
    "model": "<model-id>"
  }
}
```

## Reusing a VS Code providers file

A VS Code-style providers file (an array of
`{ name, vendor, apiKey, models: [{ id, url }] }` entries, e.g.
`chatLanguageModels.json`) can be read directly; `entry` selects an entry and
its `url` is turned into a base URL:

```json
{
  "provider": {
    "file": "/path/to/chatLanguageModels.json",
    "entry": "<provider-name>",
    "model": "<model-id>"
  }
}
```

## CLI overrides

```sh
ringko run "list the files" --provider openai --model gpt-4o-mini
```

`--provider`/`--model` override the config. The provider module
(`provider.module`) defaults to `@ringko-ai/providers`; point it at another
module (or a path) to use a different integration. If the module cannot be
loaded, the CLI reports it and fails closed.
