# Unreleased

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
