# TUI comparison and interaction improvements

This review uses the local reference repositories under `Example/`. It compares
source behavior, not screenshots alone. It does not claim parity with all features
of those products.

## Reference findings

| Reference | Source | Useful interaction patterns |
| --- | --- | --- |
| OpenCode | `packages/tui/src/component/dialog-model.tsx`, `dialog-provider.tsx`, `ui/dialog-select.tsx` | Searchable model lists; Favorites, Recent and provider categories; Popular/Providers categories; paged selection; separate provider and authentication steps. |
| Open-ClaudeCode | `src/keybindings/defaultBindings.ts`, `components/PromptInput/PromptInputHelpMenu.tsx`, `components/ModelPicker.tsx` | Context-specific shortcuts; visible shortcut help; history, stash and external-editor actions; model selection with effort. |
| openclaude | The same keybinding/input modules, plus `components/ProviderManager.tsx` and `ModelPicker.tsx` | Provider profiles and presets; staged connection forms; cross-profile model switching; explicit discovery/loading feedback. |
| Pi | `packages/coding-agent/src/core/keybindings.ts`, `packages/tui/src/keybindings.ts` | Model cycling and selection, thinking/tool toggles, grapheme-aware editing, history, alternate-screen navigation, external editor and queued follow-ups. |

## RKH changes

- `/model` and Ctrl+L open a searchable list grouped by provider. The current
  model is marked; the selected model id remains visible even when its display
  name is shared with another model.
- `/connect` now opens Popular and Custom providers groups, then that provider's
  model list. These are configured providers, not an invented list of integrations.
- Selectors show a bounded window, empty-search feedback, position, page navigation
  and cancellation. Search includes provider name, display name and model id.
- The input supports multiline text, bracketed paste, grapheme editing, bounded
  display, line editing and history with draft restoration. Opening a picker
  preserves the draft.
- The transcript pages actual wrapped terminal rows. It supports long responses
  and CJK widths; tool results can be expanded or collapsed.
- Resume displays stored conversation rows and titles. Model changes retain
  the conversation context. `/new` creates a separate stored session.
- Display toggles do not rebuild the active agent. Configuration changes are
  serialized against a running agent; failed model creation retains the old client.

## Shortcuts

| Key | Action | Source |
| --- | --- | --- |
| Ctrl+L | Model selector | Pi |
| Ctrl+P | Next model | Pi |
| Alt+P / Ctrl+Shift+P | Previous model | Pi platform defaults |
| Shift+Tab | Cycle reasoning depth | Pi |
| Ctrl+O | Toggle tool result details | Pi |
| Ctrl+T | Toggle thinking display | Pi |
| Ctrl+X | Copy last assistant answer | Pi |
| Ctrl+R | Session picker | RKH addition (Claude uses history search) |
| PgUp / PgDn | Transcript history | Pi navigation pattern |
| Up / Down | Cursor between logical lines; prompt history at outer boundaries | Editor pattern |
| Shift+Enter / Alt+Enter | Newline | Portable terminal fallbacks |
| Ctrl+A/E, Ctrl+U/K/W | Line start/end and deletion | Readline/Pi editing pattern |
| Esc | Interrupt run; close selector | Pi |
| Ctrl+C | Clear draft or interrupt run | Pi |
| Ctrl+D | Exit only with an empty draft while idle | Pi |

Some terminals cannot distinguish Shift+Enter or Ctrl+Shift+P from their
unmodified keys. Use Alt+Enter and Alt+P in that case. `/shortcuts` shows the help.

## Remaining gaps

Favorites and persistent recent-model lists, a provider credential/setup wizard,
customizable shortcut files, external-editor integration, undo/redo, queued
follow-ups, file/image attachments, session branching/tree navigation and fuzzy
search are not implemented in this change. OAuth remains OpenAI and GitHub
Copilot; grouping does not add new protocol/authentication integrations.

## Verification and review scope

Tests exercise grouped search and empty selection, Unicode editing, bounded
paste and terminal-control removal, multiline submission, history/draft restoration,
shortcuts, wrapped transcript paging, model context preservation and new sessions.
The TUI executable is compiled after the changes.

The security review covers terminal input/display, selector actions and touched
session/model transitions. All rendered conversation text is sanitized to prevent
OSC/CSI terminal injection; input is capped at 65,536 UTF-16 units without splitting
accepted graphemes. Credentials are not displayed by the new provider browser.
`wrap-ansi` and `string-width` are already used in the terminal dependency tree;
they are declared directly for correct CJK/Unicode layout rather than replacing
cell-width logic with a partial implementation. This is not a repository-wide
security audit. Clipboard delivery still depends on terminal/native support, and
OAuth cancellation remains the existing hide-until-completion behavior.
