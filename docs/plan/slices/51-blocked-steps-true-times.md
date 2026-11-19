### Slice 51 — Blocked step state, true step times, and a visible reason when a card reopens (bug)

*Planned.* Bug, the board's part. The client's part is planned in the owner's private config repo.

**Touches:** `src/domain/stepTypes.ts`, `src/domain/steps.ts`, `src/domain/docSync.ts`, `src/domain/checks.ts`,
`src/domain/boardGroups.ts`, `src/mcp/instructions.ts`, `web/src/`, `plugin/scripts/report-progress.mjs`,
`plugin/scripts/hooks/goal-reminder.mjs`, `plugin/skills/agent-board/SKILL.md`, `test/`

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

## Work

- [ ] **A.** `StepState.Blocked` in the domain, MCP schema, plugin validation and the reporting rules text (both
  copies, `test/pluginRules.test.ts`); orange/red in the card; blocked-on-owner steps in Needs you.
- [ ] **B.** Reported `started_at`/`done_at` accepted and validated; a stamped-by-server flag; durations hidden when
  guessed.
- [ ] **C.** Slice card shows its check items after the steps and counts them in progress; a reopen writes a history
  note with the reason and the card shows it.
- [ ] **D.** Doc sync leaves a done slice with an open check done, so it groups as Built.
- [ ] **E.** Tests for each, and a plugin release so clients can send the new fields.

## Verification

- A test slice with 11 done steps and one open blocked check reads 11 of 12, shows the check as an orange step with its
  note, and groups as Built.
- A batched late report without times shows no durations; one with times shows the reported durations.
