### Slice 46 — Follow-ups left open by Slice 45

*Planned 2026-11-19 by the feedback loop of night 2026-11-19-0243 ([note](../notes/2026-11-19-0243-feedback-loop.md)).
Settled the same day by the starter session under the owner's standing rule (no review or approval round; "build all"
for Slice 45): build every item, the two correctness faults first; item 8 keeps the decision the loop recorded.*

*Built 2026-11-19 (wave), draft PR #172, not merged. No device involved.*

**Touches:** `plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/sync-docs.mjs`, `plugin/scripts/usage-tick.mjs`,
`src/mcp/schemas.ts`, `plugin/scripts/report-progress.mjs`, `plugin/scripts/hooks/hook-input.mjs`,
`plugin/scripts/hooks/waiting-card.mjs`, `plugin/scripts/sync-docs.test.mjs`, `plugin/scripts/hooks/hooks.test.mjs`,
`plugin/scripts/hooks/waiting-card.test.mjs`, `plugin/scripts/usage-tick.test.mjs`, `plugin/scripts/report-progress.test.mjs`,
`test/mcp.test.ts`, `plugin/scripts/hooks/goal-reminder.mjs`, `web/src/cards.ts`, `test/sessionWeb.test.ts`,
`src/mcp/tools.ts`, `docs/clients.md`

*Premise check (wave 2026-11-19, on origin/main 693b5d0): all nine items still open; current places: item 1
`session-done.mjs:99` (`reCloseIfClosedMeanwhile` after `sendCard`), item 2 `spanEnd` `sync-docs.mjs:537` and
`actionBar` :549, item 5 `logSender` `report-progress.mjs:197`, item 7 `SHORT_FLAG` `waiting-card.mjs:33`, item 8 notice
already at `sync-docs.mjs:822` (only `docs/clients.md` lacks it), item 9: `MARKDOWN_ADDRESS` `web/src/cards.ts:83`,
emptied action `ownerTitleFields` `sync-docs.mjs:577`, PEM replace `waiting-card.mjs:354`, `addStoppedAgent`
`hook-input.mjs:229`, link-drop `clipStrings` `src/mcp/tools.ts:59`/:119. No migration.*

#### Why

Slice 45 (PR #167) closed its review by the *check passes converge* rule and copied the rest into its own file under
*From review*. A slice file of a built slice is not tracked work, and the wave's index pass wrote no *Outstanding work*
line for them (feedback loop 2026-11-19-0243, digest entries 2211, 2219, 2275). The two "important" ones are
correctness faults; the Stop-hook re-close is the third finding on the same path (pass-2 #9, check #1/#2, check-3 #1),
so it gets one by-construction fix, not another patch.

#### Work

- [x] 1 (important): `plugin/scripts/hooks/session-done.mjs:99`: a held Stop report can land after a SubagentStop close and
  leave the card in progress. Design one rule for "a later close wins" (for example a close time in the goal file every
  send compares against) instead of re-reading after the hold write. Test: hold, close, held send arrives; card stays closed.
- [x] 2 (important): `plugin/scripts/sync-docs.mjs:417`: `actionBar`/`spanEnd` split at a ` | ` inside a double-backtick
  span; `spanEnd` matches a run of N backticks. Test with ``` ``a | b`` ``` in an owner step.
- [x] 3: `plugin/scripts/usage-tick.mjs:61`: a failed dynamic import is no longer rethrown for non-direct importers; log,
  then rethrow when not invoked directly (direct runs still exit 0).
- [x] 4: `src/mcp/schemas.ts:215`: the `details_md` description says null "keeps what is stored", but null clears a
  doc-synced owner step's details (`detailsOf`, `src/domain/docSync.ts`); fix the text.
- [x] 5: `plugin/scripts/report-progress.mjs:333`: `logSender` rewrites the whole log past 400 lines and can drop concurrent
  lines; trim now and then, or write a temp file and rename.
- [x] 6: `plugin/scripts/hooks/hook-input.mjs:77`: `removeStaleTemps` runs on every `writeJson` and one failed `statSync`
  ends the sweep; try/catch per entry, sweep now and then.
- [x] 7: `plugin/scripts/hooks/waiting-card.mjs:242`: `SHORT_FLAG` at line start masks `cc -Wall ...` and `-s foo` lines;
  require a space before `-W`, or limit the line-start form to continuation lines.
- [x] 8 (medium, skipped #2 of `pr-167-medium`): an empty status table sends an empty snapshot that closes the project's
  doc-synced items. Decision (feedback loop, keeping what main does): an empty table still closes them, because a
  finished project has an empty table and its cards should close (night 0243's housekeeping sync showed `closed=0`,
  nothing lost). The work is only to make the message and `docs/clients.md` say so; the owner can reverse it.
- [x] 9: the skipped mediums of Slice 45's *From review* marked "follow-up": `MARKDOWN_ADDRESS` with `]` or `)`, the
  emptied "Slice N:" action losing its steps, the PEM replace scanning before the 4096 cut, the `addStoppedAgent`
  retry that repairs only one rmdir race (`pr-167-check-medium` #5), and the link-drop pass that rebuilds even when no
  link was dropped (`pr-167-medium` #8).

#### Changed while building

- Item 1 rule: Stop's held report time is taken before the hold write; a close recorded in the goal file (`closedAt`, or
  `closing` while a close call is in flight, cleared in `finally` on every outcome) at or after that time wins
  (`closeLaterThan`, `plugin/scripts/hooks/session-done.mjs`).
- Item 2: `spanEnd` closes a code span only at a backtick run of the same length.
- Items 7 and 9 masking: line-start flags are masked on the first line and after a line ending in `\`, a backtick or `^`;
  `-W` needs a separate value; a cut tail starting inside a PEM body (base64 lines of 40+ characters) is masked to the END
  line or the end of the run.

#### From review

All five findings files were read to their last finding. Fixes applied: high 1 2 4 5 7, medium 1 2 4 5, check 1 3 5,
check-2 1 2. Every finding left out has its own line below. The third check had 7 nits, none blocking: the check passes
converged, and all seven are listed as follow-ups below.

- Skipped #3 (`reviews/pr-172-high.md`): "Builder's known behaviour: a failed close leaves `closing` set" - a second mark_done on an already-closed card is idempotent and the 2.5 s window is bounded.
- Skipped #6 (`reviews/pr-172-high.md`): "Temp sweep runs once per process per file" - hooks are short-lived processes, so once per process per file is already "now and then".
- Skipped #3 (`reviews/pr-172-medium.md`): "`tailOf` now returns an object and is newly exported. The only caller is `cardText`, which is updated" - `cardText` is the only caller and was updated; the reviewer's own grep found no other.
- Skipped #2 (`reviews/pr-172-check-medium.md`): "`closing` is one timestamp shared by every close of a card" - two overlapping closes of one card both end in a closed card, so clearing `closing` early only allows a redundant, idempotent mark_done.
- Skipped #4 (`reviews/pr-172-check-medium.md`): "`tailOf` returns `cutStart`, but nothing reads it." - over-masking a leading short flag is the safe direction and was accepted in fix pass 2.
- Skipped #6 (`reviews/pr-172-check-medium.md`): "`senders.log.<pid>.tmp` is removed only when write or rename throws" - a temp file stays only when the hook process is killed between write and rename, and `removeStaleTemps` does not sweep it (a pid-named file is not overwritten by a later pid); follow-up: sweep `senders.log.*.tmp` in the trim or use a fixed temp name.
- Skipped #7 (`reviews/pr-172-check-medium.md`): "`const SHORT_FLAG =/` has no space" - formatting only.
- Skipped #3 (`reviews/pr-172-check-2-medium.md`): "`tailOf` returns `cutStart` but `cardText` reads only `tail.text`, so the flag is dead" - over-masking a leading flag is the safe direction, accepted in fix pass 2.
- Skipped #4 (`reviews/pr-172-check-2-medium.md`): "`sentText` calls `maskSecrets` on an already masked sentence," - a sentence that starts with a `-p` flag is masked, the safe direction.
- Skipped #5 (`reviews/pr-172-check-2-medium.md`): "CONTINUATION_END treats a trailing backtick or caret as a continuation mark" - over-masking after a trailing backtick or caret is the safe direction, accepted in fix pass 1.
- Skipped #6 (`reviews/pr-172-check-2-medium.md`): "The pre-close `saveGoal(id, { closing: Date.now() }, ...)` sits outside the `try`" - a locked goal file fails the hook open and the next Stop retries the close.
- Skipped #7 (`reviews/pr-172-check-2-medium.md`): "`closeLaterThan` counts any `closing` value inside CLOSING_WINDOW_MS" - the wall-clock window is the slice's chosen design for item 1, whose Work item names a close time.

Third check pass (pr-172-check-3-medium), seven nits, none blocking, left open as follow-ups:

- Follow-up #1: `cutStart` from `tailOf` is read only by tests; `maskSecrets` and `sentencesOf` always pass `leadContinued = true`, so an uncut first line starting `-s foo` is masked. Drop `cutStart` or pass it as `leadContinued`; move the comment above `tailOf`.
- Follow-up #2: `CONTINUATION_END` counts a trailing backtick or caret as a continuation; require whitespace before it. Fix the `SHORT_FLAG =/` spacing.
- Follow-up #3: `KEY_BODY_TAIL` / `KEY_RUN_TAIL` mask any leading run of 40+ character base64-alphabet lines at a cut start with no PEM header seen; apply only when a header was found before the cut or an END line follows.
- Follow-up #4: `MARKDOWN_ADDRESS` in `web/src/cards.ts` reads single-backtick spans while `sync-docs.mjs` reads equal-length runs; reuse the equal-length rule or confirm sync never emits such spans.
- Follow-up #5: the sender-log trim is gated by size (80 KB), not line count; with long lines every `logSender` call re-reads the whole file without trimming.
- Follow-up #6: `closing` stays set if the hook is killed at its timeout, so a Stop report inside the window triggers one spurious extra `mark_done` after a resume; note it or tie the window to a landed close.
- Follow-up #7: the module-level `sweptFiles` set in `hook-input.mjs` assumes short-lived processes; in a long-lived process, temps from a later failed rename are never swept.

#### For CLAUDE.md

- The "later close wins" rule lives only in `closeLaterThan` in `plugin/scripts/hooks/session-done.mjs`; `closing` in the goal file is set only for the duration of a close call, and the Stop report's time is taken before its hold write (Slice 46: docs/plan/slices/46-slice-45-follow-ups.md).

#### Not yet verified

None (no device involved).

#### Verification

`npm test` green with the new tests; items 1 and 2 each have a test that fails on the code before the fix. Run on the built branch: lint, typecheck, 741 vitest, 430 node and 330 e2e tests green; the item 1 and item 2 tests fail on the old code.
