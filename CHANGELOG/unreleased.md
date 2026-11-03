# Unreleased

- Map thinking levels onto each provider's own request field: Anthropic
  `thinking`/`effort`, Google `thinkingConfig`, OpenAI `reasoningEffort`, and
  the exact provider-option key for hyphenated OpenAI-compatible providers.

- Replay assistant reasoning only in the form the active provider accepts:
  signed thinking for Anthropic, thought signatures for Google, provider items
  for OpenAI, and reasoning content for OpenAI-compatible endpoints. Foreign
  reasoning is dropped instead of being relabelled when the provider changes.

- Show delegated subagents below the prompt in the TUI with their latest
  activity, print subagent start/tool/result progress from `ringko run`, and
  surface a running-subtask row with an inspect action in the WebUI.

- Link task/subagent events in the trajectory by task id and child turn, and
  mark them as subagent records instead of opaque task payloads.

- Return plain text from `read` text, directory and notebook results instead of
  escaped JSON, so the model sees the content directly.

- Show the model recorded for the most recent run below the WebUI composer and
  after `ringko run` output.

- Describe RingKo as a set of provider-neutral Agent Harness facilities in the
  repository, npm README and npm package description, and repair the English
  README's encoding damage.
