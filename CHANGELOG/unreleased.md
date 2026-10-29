# Unreleased

- Replace the Settings language buttons with a labelled dropdown, matching the
  theme control.

- Make the approval dialog reviewable: show the exact target, mark the risk kind
  and level, focus Deny by default, and move the session/persistent grants into
  a secondary menu so only Deny and Approve look primary.
- Contain the right sidebar on small screens as an overlay with a dismiss
  backdrop instead of shrinking the transcript to a sliver.
- Stop provider edits from being lost: serialize the visual state when switching
  to JSON, validate JSON before switching back, and show an unsaved indicator.
- Persist the active instruction set in the session log at the start of each run
  so the exact instructions seen by the model can be replayed.
- Record a `run/completed` event on successful run termination so the session log
  can distinguish normal completion from interruption.
- Distinguish "tool not started" from "tool outcome unknown" when repairing
  interrupted tool calls, so retries can skip already-finished work.
- Add a "Fetch models" action to each provider in Settings. The host queries the
  provider's `/models` endpoint with a 20s timeout, merges new ids without
  overwriting edited names, and reports duplicate-only results.
- Expose `POST /api/providers/models` with provider-type and base-URL validation;
  strict discovery reports a live lookup failure instead of silently returning
  the bundled catalog.
