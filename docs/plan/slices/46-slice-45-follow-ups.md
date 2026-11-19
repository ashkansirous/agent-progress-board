### Slice 46 — Follow-ups left open by Slice 45

*Parked 2026-11-19 by the feedback loop of night 2026-11-19-0243 ([note](../notes/2026-11-19-0243-feedback-loop.md)):
`parked: feedback loop, waits for the user`. A night does not build it until the owner moves it to planned.*

**Touches:** `plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/sync-docs.mjs`, `plugin/scripts/usage-tick.mjs`,
`src/mcp/schemas.ts`, `plugin/scripts/report-progress.mjs`, `plugin/scripts/hooks/hook-input.mjs`,
`plugin/scripts/hooks/waiting-card.mjs`, `plugin/scripts/sync-docs.test.mjs`, `plugin/scripts/hooks/hooks.test.mjs`,
`plugin/scripts/hooks/waiting-card.test.mjs`, `plugin/scripts/usage-tick.test.mjs`, `plugin/scripts/report-progress.test.mjs`,
`test/mcp.test.ts`

#### Why

Slice 45 (PR #167) closed its review by the *check passes converge* rule and copied the rest into its own file under
*From review*. A slice file of a built slice is not tracked work, and the wave's index pass wrote no *Outstanding work*
line for them (feedback loop 2026-11-19-0243, digest entries 2211, 2219, 2275). The two "important" ones are
correctness faults; the Stop-hook re-close is the third finding on the same path (pass-2 #9, check #1/#2, check-3 #1),
so it gets one by-construction fix, not another patch.

#### Work

- [ ] 1 (important): `plugin/scripts/hooks/session-done.mjs:99`: a held Stop report can land after a SubagentStop close and
  leave the card in progress. Design one rule for "a later close wins" (for example a close time in the goal file every
  send compares against) instead of re-reading after the hold write. Test: hold, close, held send arrives; card stays closed.
- [ ] 2 (important): `plugin/scripts/sync-docs.mjs:417`: `actionBar`/`spanEnd` split at a ` | ` inside a double-backtick
  span; `spanEnd` matches a run of N backticks. Test with ``` ``a | b`` ``` in an owner step.
- [ ] 3: `plugin/scripts/usage-tick.mjs:61`: a failed dynamic import is no longer rethrown for non-direct importers; log,
  then rethrow when not invoked directly (direct runs still exit 0).
- [ ] 4: `src/mcp/schemas.ts:215`: the `details_md` description says null "keeps what is stored", but null clears a
  doc-synced owner step's details (`detailsOf`, `src/domain/docSync.ts`); fix the text.
- [ ] 5: `plugin/scripts/report-progress.mjs:333`: `logSender` rewrites the whole log past 400 lines and can drop concurrent
  lines; trim now and then, or write a temp file and rename.
- [ ] 6: `plugin/scripts/hooks/hook-input.mjs:77`: `removeStaleTemps` runs on every `writeJson` and one failed `statSync`
  ends the sweep; try/catch per entry, sweep now and then.
- [ ] 7: `plugin/scripts/hooks/waiting-card.mjs:242`: `SHORT_FLAG` at line start masks `cc -Wall ...` and `-s foo` lines;
  require a space before `-W`, or limit the line-start form to continuation lines.
- [ ] 8 (medium, skipped #2 of `pr-167-medium`): an empty status table sends an empty snapshot that closes the project's
  doc-synced items. Decide with the owner whether an empty table should close them (a finished project) or be refused.
- [ ] 9: the skipped mediums of Slice 45's *From review* marked "follow-up": `MARKDOWN_ADDRESS` with `]` or `)`, the
  emptied "Slice N:" action losing its steps, the PEM replace scanning before the 4096 cut.

#### Verification

`npm test` green with the new tests; items 1 and 2 each have a test that fails on the code before the fix.
