### Slice 51 — Blocked step state, true step times, and a visible reason when a card reopens (bug)

*Built (2026-11-25), PR #200.* Bug, the board's part. The client's part is planned in the owner's private config repo.

**Touches:** `src/domain/stepTypes.ts`, `src/domain/steps.ts`, `src/domain/docSync.ts`, `src/domain/checks.ts`,
`src/domain/boardGroups.ts`, `src/mcp/instructions.ts`, `src/mcp/schemas.ts`, `src/application/board.ts`,
`src/infrastructure/d1Repository.ts`, `web/src/`, `plugin/scripts/report-progress.mjs`, `plugin/scripts/sync-docs.mjs`,
`plugin/scripts/hooks/goal-reminder.mjs`, `plugin/scripts/**/*.test.mjs`, `plugin/skills/agent-board/SKILL.md`,
`docs/clients.md`, `test/`, `e2e/`, `src/api/board.ts`, `src/api/boardDto.ts` (widened while building: the card data
carries checks in progress, `blocked_on_owner` and `reopened`), `plugin/scripts/hooks/background-agents.mjs` (widened
for G: the hook's `children: []` was the cause), `src/domain/upsert.ts` (widened for G: `checkedSteps` applies the
hook rule)

Night 2026-11-25 claim notes (coordinator, no open question): Touches widened from the premise check (`schemas.ts`
holds `z.enum(StepState)`, `saveStepsReport` is in `board.ts`, doc sync's status write in `d1Repository.ts` and
`sync-docs.mjs`). Decision 1's "waiting on the owner" needs a data source: a blocked step carries an optional
`waits_on` of `work` (default) or `owner`; `owner` is red and listed under Needs you. No migration (steps are JSON in
`items.steps`). E's "plugin release" is the merge: the plugin ships from this repo's `main`. G's diagnosis reads the
bug card's history with `get_item` and the local plugin `senders.log`; if neither settles the cause, the replay test
and the fix for the reproducible half are built and the cause is recorded as likely.

## Why

Owner, 2026-11-19, on a slice card that read "11 of 11 steps · 100%", stayed open, and showed "Review pass 1 (high):
Done · 4 h 32 min" for a review that ran about 17 minutes: "why the fuck it is not showing the step with a red/orange
state clearly saying that it is blocked by other work/me?" and "I need proper data and proper dashboard, not a fucking
shit that shows wrong shit all the fucking time."

The board's share of the fault (read 2026-11-19 from `get_item` on that card and this repo's `main`):

1. Step states are only done, active and pending (`plugin/scripts/hooks/goal-reminder.mjs` `STEP_STATES`,
   `src/domain/stepTypes.ts`): a step blocked on other work or on the owner cannot be shown.
2. The server stamps `started_at` and `done_at` itself (`stepTypes.ts`, `steps.ts` `stamp`): a late or batched report
   gets "now" as its times, so the card shows wrong durations with no sign they are guessed. (The client sent its last
   step report at review start and the rest hours later in one report; that is the client's fault, planned there.)
3. Doc sync moved the card from done back to in progress because the slice has an open check, and the card showed
   11 of 11 steps and no reason. Slice 42's "Built" rule did not show it as Built, because the stored status was
   in progress, not done.

## Decisions

Decided by this session (bug fix, no open question):

1. A new step state `blocked`, shown in orange, with a required note saying what it waits on and an optional link; a
   blocked step waiting on the owner is shown in red and listed under Needs you.
2. A step report may carry `started_at` and `done_at`; the server keeps them when given (not in the future, start
   before end) and records which times it stamped itself. The card shows a duration only when both ends were reported
   or seen live; otherwise it shows no duration.
3. A slice card lists its open checks after its steps, each with its state, and the progress line counts them: a card
   with an open check never reads 100%. A doc-sync reopen writes a history note with the reason, and the card shows it.
4. A merged slice with an open check is shown as Built (Slice 42) whatever the doc sync's status write was; the sync
   does not move a done slice back to in progress for an open check.
5. *Added 2026-11-22 from the owner's phone scope "Process optimiser and true per-step telemetry" (decision "Which step
   time wins", approved by the owner 2026-11-21; folding it into this slice approved by the owner 2026-11-22):* every
   stored step time carries its source: `observed` (a plugin hook saw the change as it happened, Slice 53), `reported`
   (the agent sent the time) or `stamped` (the server used its own clock). A later report replaces a time only with one
   from a source at least as good: observed, then reported, then stamped. An observed time is never overwritten by a
   reported or stamped one. The card shows the source of each time (stamped times stay hidden as durations, Decision 2),
   and the detail drawer names it ("seen by hook", "reported", "guessed").

## Work

- [x] **A.** `StepState.Blocked` in the domain, MCP schema, plugin validation and the reporting rules text (both
  copies, `test/pluginRules.test.ts`); orange/red in the card; blocked-on-owner steps in Needs you.
- [x] **B.** Reported `started_at`/`done_at` accepted and validated; a stamped-by-server flag; durations hidden when
  guessed.
- [x] **C.** Slice card shows its check items after the steps and counts them in progress; a reopen writes a history
  note with the reason and the card shows it.
- [x] **D.** Doc sync leaves a done slice with an open check done, so it groups as Built.
- [x] **F.** Time sources (Decision 5): `started_source` / `done_source` on each stored step (`observed | reported |
  stamped`), the precedence rule in one place in `src/domain/steps.ts` (used by `saveStepsReport`), the MCP schema and
  reporting rules text (both copies) taking an optional source on reported times (only the plugin's hooks send
  `observed`), the drawer naming the source. Tests: an observed end time survives a later batched report; a reported
  time replaces a stamped one; a stamped time never replaces either.
- [x] **G.** *Added 2026-11-22 (bug card `agent-progress-board/bug-steps-kept`, seen by a desk session on its own task
  card):* a report that sent step `refine` without a `children` field came back with `children: []`, although the
  stored step had three children and the rules text says they are kept (`keptChildren` in `src/domain/steps.ts`). The
  same reply showed every done step's `started_at` and `done_at` as the report's time. The cause is not known yet: the
  live Worker may be older than `main`, or the plugin's own hook report (`source: hook` on the reply) may have sent the
  tree without them. Find which from the item's history and the plugin's `senders.log`, fix it, and add a test that
  replays the two reports.
  *Fixed (fix pass 2):* the server is not the cause: `test/stepsTools.test.ts` replays the two reports (three stored
  children, then a report without `children`) and the three are kept; only an explicit `children: []` clears them. The
  cause is in the hook: `emptiedKeys`/`attach` in `plugin/scripts/hooks/background-agents.mjs` sent `children: []` for a
  step whose agents had aged out, wiping stored children the hook never filled (confirmed by the `mergeSteps` test that
  used to assert `children: []`, now asserting the key is absent). The hook now never sends `children: []`; one cost: an
  aged-out agent's old row stays on the board until the session resends the step with its own children. Touches
  widened with `plugin/scripts/hooks/background-agents.mjs`. The `started_at`/`done_at` half is Work A-D's rule
  (times only from the report), not changed here.
  *Third strike, one design (replaces the two hook rules above):* a report with `source: "hook"` (the marker the hooks
  already send; no new field) is turned into input by `hookStepsInput` in `src/domain/steps.ts`, called from
  `checkedSteps` (so `saveStepsReport` stores it). Its step list is the whole list, as before G: a stored step the hook
  does not send is dropped at every level, so no stored step is kept unmatched or re-validated. For each step it sends,
  the non-agent children (ids not starting `agent-`, `agentRowId`) are the ones it sent if it sent any, else the stored
  step's non-agent children kept as stored (deeper levels included); the agent rows are exactly the ones it sent (none:
  none kept). Non-agent children come first in their order, agent rows after. A session or agent report keeps the old
  rule (children omitted: kept; sent: replace). Tests: `test/stepsTools.test.ts` (hook report with no agent rows keeps three children and drops
  the row; session report without children keeps all), `hooks.test.mjs` (the hook sends no `children: []`).
  Follow-ups (not code): #3 "`timeFields` can send `started_at`/`done_at` with no source; the server defaults a missing
  source to `reported`, so a server-stamped guess echoed back without its source becomes "reported"."; #4
  "`orderedTimes` fixes start-after-end by stamping the end with `now` only if `now >= start.at`; with no `now` ... the
  end becomes `start.at` with source `stamped`, a 0 s step. Confirm every `normalizeSteps` caller passes `now`, or test
  the null path".
- [x] **E.** Tests for each, and a plugin release so clients can send the new fields.

## Verification

- A test slice with 11 done steps and one open blocked check reads 11 of 12, shows the check as an orange step with its
  note, and groups as Built.
- A batched late report without times shows no durations; one with times shows the reported durations.
- A step whose end was sent as observed at 10:05 and then marked done again in a batched report at 10:50 keeps 10:05 and
  reads "5 min, seen by hook" (the phone scope's "active 1 h, really done 45 min ago" case).

#### From review

- Skipped #8 (`reviews/pr-200-high.md`): "Any MCP caller may send `started_source` / `done_source` = observed (the whole `TimeSource` enum), though docs say only a plugin hook may." - the server cannot tell a hook from an agent, both send with the plugin's token; Decision 5 makes `observed` a client convention.
- Skipped #9 (`reviews/pr-200-high.md`): "Every stored step with no source reads as "stamped", and the page hides durations for a stamped end ... Decision 2 says durations show when both ends were reported or seen live" - Decision 2 is "The card shows a duration only when both ends were reported or seen live", and a time the board stamped is neither.
- Skipped #4 (`reviews/pr-200-medium.md`): "betterTime compares rank with >=, so a re-sent older `reported` time overwrites a stored `reported` one." - Decision 5: "A later report replaces a time only with one from a source at least as good", so an equal source replaces.
- Skipped #5 (`reviews/pr-200-medium.md`): "parseStoredSteps marks all legacy times (no source fields) as `stamped`, so trueDuration is null for every already-stored finished step." - Decision 2: "The card shows a duration only when both ends were reported or seen live"; a legacy time is neither.
- Applied pass-2 #1 (second strike on the done-slice exemption) by one design: after the snapshot's own checks are applied, a done slice the documents call in progress stays done only when at least one check is counted (`isCountedCheck`) in that resulting state, stored or new in this snapshot; else it reopens with the history note. One function, `keepsDoneForChecks` in `src/domain/docSync.ts`, tested for a new check, a stored open check, all checks done and no checks.
- Applied pass-2 #2, #3, #6, #7: the hook never sends a `stamped` time back; `blocked_on_owner` only for a live card (not done, not stale, heartbeat not expired); a bad `link` or `waits_on` on a step is dropped in `buildStep`, never refuses the report; the card's checks heading counts the rows it shows.
- Applied #3 by counting a blocked check (`COUNTED_CHECK_STATUSES` in `src/domain/checks.ts`: open, in progress, blocked; stale is still not counted), so progress, the checks heading, Built and `OPEN_CHECK_OF` agree; the Slice 42 and 47 tests that said a blocked check is not counted were changed to match.
- Applied pass-3 (`reviews/pr-200-check-medium.md`) #1 to #5: `stepWords` reads `shownState` and `blockedKey`; an owner-blocked card's `needs_you_at` is the earliest `started_at` of its owner-blocked steps (`ownerBlockedSince`, set in `waitingSinceOf` in `src/api/board.ts`; `groupBoard` unchanged); `givenTime` takes only ISO times with a zone; `reopened` carries `status` and the page words it; the hook sends `started_at` only for non-pending and `done_at` only for done steps.
- Applied pass-4 (`reviews/pr-200-check-4-medium.md`) #2: the MCP schema takes any string (bounded) for a step's `waits_on` and `link`; `buildStep` drops a bad one. Follow-ups (not code), with the finding's words: #1 "ownerBlockedSince uses a step's old started_at; the card shows "waiting on you" since the step began, not since it was blocked. Fix: stamp when the step entered blocked."; #3 "stepProgress returns null for empty steps even with open checks; slice with checks only shows no bar or count."; #4 "hookStep/hookLevel: sent step with id and renamed label never matches stored id-less step; stored non-agent children lost on next hook report."; #5 "statusAfterSync keep-done decision uses snapshot checks, OPEN_CHECK_OF counts every check row under the parent; rules can disagree ... Add equality test."; #6 "timeFields sends echoed started_at/done_at with no source when none was echoed; server stores as reported, promoting a stamped guess. Send only when source is reported or observed."
- Skipped #6 (`reviews/pr-200-check-medium.md`): "A reported `started_at` up to 60 s ahead is accepted; a running step shows "Running · 1 min" and a future "Started" time. Fix: clamp to `now`." - Decision 2's validation allows a small future skew, and the fix pass 1 design set it to 60 s; a minute's lead reads the same.
- Applied pass-5 (`reviews/pr-200-check-2-medium.md`) #1 and #2 by the third-strike design in G (`hookStepsInput`; the replay test asserts the stored tree); #3 and #4 are the follow-ups listed in G.
- Applied pass-6 (`reviews/pr-200-check-3-medium.md`) #1, #2, #4 and #5 by the same `hookStepsInput` design (the hook's copy gives membership and order, stored steps are not re-fed, the hook sends no `children: []`). Follow-up (not code), with the finding's words: #3 "Agent rows are identified only by the `agent-` id prefix and `source: "hook"` is trusted. A session step with id `agent-plumbing` is dropped by a hook report that does not send it, or moved to the end."
- Converged (`reviews/pr-200-check-5-medium.md`, 4 nits, all follow-ups, no code): #1 "hook merge keyed on client-sent `source: "hook"`; any client can trigger it and cannot clear step children."; #2 "`ownerBlockedSince` uses step `started_at`, so a long-running step shows as waiting since its start when blocked."; #3 "`isStoredStep` rejects unknown `waits_on`/state, so a rollback or bad value makes the whole step list parse as null."; #4 "blocked step with empty note refuses the whole report instead of defaulting the note."
- Merge with Slice 50 checked (`reviews/pr-200-check-6-medium.md`, no important findings). Follow-up (not code): #1, an
  `apply_batch` upsert of a done slice sent as in progress with no checks field ignores its stored open checks and
  reopens it; the caller named the content, which fits Slice 50's revive rule.

*Changed while building:* a blocked check counts in progress and Built (`COUNTED_CHECK_STATUSES` in `src/domain/checks.ts`); a bad reported time, `waits_on` or `link` is dropped and never refuses a report; stored times without a source read as stamped and show no duration (Decision 2); a hook report's step list is the whole list (`hookStepsInput`). G's cause was confirmed by a replay test: the plugin hook's emptied-step branch sent `children: []`.

#### For CLAUDE.md

- The step-time source precedence (observed, reported, stamped) lives only in `betterTime` in `src/domain/steps.ts`, used by `saveStepsReport`; never compare sources elsewhere (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- "A step is blocked on the owner" is one rule, `ownerBlockedSteps` in `src/domain/stepTypes.ts`; never a second copy (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- A hook report's (`source: "hook"`) children rule is one function, `hookStepsInput` in `src/domain/steps.ts`: the hook owns only `agent-` rows and its step list is the whole list (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- The done-slice keep rule (a done slice with a counted check stays done in doc sync) is `keepsDoneForChecks` in `src/domain/docSync.ts` (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- Blocked colours come from the config palette (`needFg` / `bugFg` families), never a literal (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).

#### For README.md

- A step state `blocked`, with `waits_on` (`work` or `owner`) and an optional `link`.
- Steps take `started_at` / `done_at` with a source (`observed`, `reported`, `stamped`).

#### Not yet verified

- [chrome] On the live board after the release, a slice card with a blocked step shows orange, and an owner-blocked one shows red under Needs you.
- [session] In a real session, the hook's reports keep the session's own step children and drop an aged-out agent row.
