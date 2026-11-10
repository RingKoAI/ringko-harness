# Usage statistics

Open **Settings → Usage statistics**. The default view includes the last seven
local calendar days across the active workspace's sessions. Select today, the
last 30 days, all time, or a custom inclusive date range; narrow the data to the
current session, provider, model or call type. The chart switches between Tokens
and recorded calls. Provider/model summaries and call-history pages use the
same filtered records as the overview. Auto-refresh runs every 30 seconds while
the page is mounted and can be disabled; manual refresh remains available.

## Data semantics

- The source is persisted `model/usage` events, not the current transcript.
  Compaction does not remove usage. Archived sessions remain included; deleting
  a session removes that log from subsequent scans.
- Input Tokens already include cache reads and writes. Total Tokens are input
  plus output; cache counts must not be added again. Cache hit rate uses only
  calls reporting both input and cache-read counts, weighted by input Tokens.
- Missing timing, model identity and token fields remain unknown. Durations are
  whole-call times, not time to first token. Calls lacking usage events and
  failed requests without reported usage cannot be counted as recorded calls.
  No cost or success-rate figures are inferred from those records.
- Inherited fork prefixes are counted once in workspace totals. The call belongs
  to its original session while that parent log is available. Current-session
  filters count that session's new calls, excluding inherited parent usage.
  Matching is restricted to declared ancestry, so independent equal-sized calls
  are not merged. For a deleted parent, surviving siblings share inherited
  records when the timestamp predates the branch creation.
- Date filtering is start-inclusive and end-exclusive. The UI sends the user's
  IANA time zone for calendar buckets; custom end dates include the selected
  day. Ranges longer than 90 days use monthly buckets.

## Terminal overview

In the TUI, `/status` opens **Settings → Stats → Overview**. `/stats` opens the same
page. The overview uses a calendar heatmap and paired metrics; Left/Right or O/M
switches to **Models** for per-model call/token/cache totals. T selects all time,
the last 7 days or the last 30 days; these terminal ranges are rolling intervals.

The heatmap counts deduplicated reported model calls for the latest 366 local
calendar days (recent weeks on narrow terminals). Range filters apply to activity
and totals together. Favorite model means most recorded calls, breaking ties by
the model-summary order. Active days count local dates with reported calls; the
denominator runs from the first matching call to the selected range's end. A
current streak may end today or yesterday; a longer gap resets it. Longest session
is its creation-to-last-matching-call span, clipped to the selected range, and
includes idle time. These metrics do not estimate unreported requests or active
working hours. Older backends without activity metadata show a restart hint.

## API and limits

`GET /api/usage` uses the backend's existing authentication, origin and workspace
checks. Optional query fields are `start`/`end` (epoch milliseconds), `timeZone`,
`provider`, `model`, `sessionId`, `kind`, `offset` and `limit` (1–100, default 25).
Filters are exact matches. A session ID never broadens the workspace scope.
Responses contain usage metadata and session titles, not prompts, tool content,
provider configuration or credentials.
The optional `activity` object contains bounded daily counts, local calendar
streaks, active-day coverage and the longest recorded session span.

Scans reject linked logs/directories outside the trusted workspace-session
directory. Limits are 2,048 directory entries, 16 MiB per log, 128 MiB total,
100,000 usage events and 512 model identities per scan. A short-lived cache
shares concurrent scans and retains at most four workspace snapshots. Large,
corrupt or unreadable logs are skipped with explicit coverage metadata; reaching
a scan limit marks statistics incomplete. This is not an accounting ledger or
a hostile-local-user-proof file-access boundary: Windows lacks portable
descriptor-relative no-follow traversal for directory ancestors.

The frontend and backend must both be updated. Restart an older running backend
to enable the new `/api/usage` endpoint after rebuilding.
