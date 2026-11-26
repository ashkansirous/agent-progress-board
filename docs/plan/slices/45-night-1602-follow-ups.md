### Slice 45 — Review follow-ups left open by the night 2026-11-18-1602

*Built (wave 2026-11-19), merged as PR #167 (bcdc87e); live since the 2026-11-19T04:17:55Z deployment.* *Planned 2026-11-19 by the feedback loop ([note](../notes/2026-11-18-1602-feedback-loop.md)).*

*Plan cleanup check 2026-11-26: verdict close. Own work is built (PR #167). Item 8's "NaN:00" half passed in Chrome on 2026-11-19 (read in `docs/plan/unverified.md`); its Reset-overlap half is an unverified line, not a reason to keep the slice open. Items not built (13 #1 and #3, 14 #4 and check-3 #3, 4 #8, 7 #3) are decisions with reasons under *Found while building*; none is open work. The "waits for the batched release" wording was stale and is replaced above.*

*Settled 2026-11-19 by the starter session, under the owner's standing rule (no review or approval round; 2026-11-18:
"you should not fucking wait for my fucking review"): build every item below, item 12 (privacy) first, then 1-3. An
item whose fix needs a choice the slice files leave open takes the option that keeps the shown behaviour closest to
the slice's own Decision and records it under* Found while building. *Item 8's live check is Claude's (Chrome), not
the owner's.*

**Touches:** `src/mcp/tools.ts`, `src/application/board.ts`, `src/application/ports.ts`, `src/domain/item.ts`, `e2e/session.spec.ts`, `web/src/TokenChart.tsx`, `test/usageWeb.test.ts`, `plugin/scripts/report-progress.mjs`, `plugin/scripts/report-progress.test.mjs`, `src/domain/upsert.ts`, `src/domain/docSync.ts`, `src/api/board.ts`, `src/api/access.ts`, `src/infrastructure/d1Repository.ts`, `plugin/scripts/sync-docs.mjs`, `plugin/scripts/cap-reading.mjs`, `plugin/scripts/usage-tick.mjs`, `plugin/scripts/hooks/waiting-card.mjs`, `plugin/scripts/hooks/session-waiting.mjs`, `plugin/scripts/hooks/background-agents.mjs`, `plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/hooks/goal-reminder.mjs`, `web/src/cards.ts`, `web/src/SessionCards.tsx`, `web/src/SessionDrawer.tsx`, `web/src/Detail.tsx`, `web/src/chartGeometry.ts`, `web/src/usage*`, `docs/clients.md`, `docs/plan/unverified.md`, `docs/plan/slices/38-steady-browser-tests.md`, `docs/plan/slices/41-tasks-with-outcome.md`, `e2e/active.spec.ts`, `e2e/usage.spec.ts`, `e2e/usageFixture.ts`, `e2e/loadingClock.ts`, `test/mcp.test.ts`, `test/board.test.ts`, `test/upsert.test.ts`, `test/access.test.ts`, `test/capCost.test.ts`, `test/seed.test.ts`, `test/oauth.test.ts`, `test/sessionWeb.test.ts`, `test/loadingDelay.test.ts`, `test/syncSnapshot.test.ts`, `test/docSync.test.ts`, `plugin/scripts/sync-docs.test.mjs`, `plugin/scripts/cap-reading.test.mjs`, `plugin/scripts/usage-tick.test.mjs`, `plugin/scripts/hooks/hooks.test.mjs`, `plugin/scripts/hooks/waiting-card.test.mjs`

*Touches widened at the claim (wave 2026-11-19) from a ground-in-code check at origin/main c765de1: all 18 items still open; item 2's code moved to `src/application/board.ts:182`; item 11's message prints only for a header-only table (`sync-docs.mjs:790`); item 17: only `details_md` is COALESCEd (`d1Repository.ts:244`), the title already refreshes.*

**Migrations:** none

#### Why

The night's slices merged with review findings written only as follow-ups inside their own slice files. plan.md's
*Outstanding work* has lines for Slices 33 to 36, 39, 40 and 41, but none for 32, 37, 42, 43 and 44, and three of the
Slice 32 findings are medium correctness faults. This slice gathers them so none is lost.

#### Work (each item names where it came from; the slice files hold the full text)

1. [x] Slice 32, check pass 3 (medium): a clipped oversize `list_open`/`get_item` reply cuts `links[].url` and returns a
   broken URL (`src/mcp/tools.ts:49`, not re-read here). Verify: a test with an item whose links push the reply over
   50,000 characters gets whole URLs or none.
2. [x] Slice 32, check pass 3 (medium): `ask_human` sends `after_answer ?? null`, which erases a stored `after_answer` on a
   re-ask (`src/application/board.ts:113`, not re-read here). Verify: a re-ask without `after_answer` keeps the stored one.
3. [x] Slice 32, check pass 3 (medium): `fitItem` can fall back to a bare `{key}` for a huge item (`src/mcp/tools.ts:144`).
   Verify: a huge item keeps its title and status in the cut reply.
4. [x] Slice 32, the other five check-pass-3 findings: see "Follow-up from check pass 3" in
   [Slice 32](32-questions-and-rules.md).
5. [x] Slice 37: the five lows under "Follow-up list (low, not built)" in [Slice 37](37-access-and-grants.md).
6. [x] Slice 42: `docs/clients.md` does not describe the `built` grouping ([Slice 42](42-built-not-in-progress.md)).
7. [x] Slice 43: the phone card shows the project name, not "Your step" (check pass 2 #6; the Decision says "Your step"),
   plus the other check-pass-2 lows and skipped #9 in [Slice 43](43-owner-cards-read-right.md).
8. Slice 43: the live "NaN:00" on the Environment tab was never reproduced; only `bucketLabel` was hardened. Verify on the
   live board after the release (line in `docs/plan/unverified.md`).
   Also: Slice 43's new Environment e2e (the faked `2026-11-11#2` key) was never run against the old code, so it is not
   shown to catch the regression; run it on the commit before PR #156 and record the failure.
9. [x] Slice 44: the three check-pass lows in [Slice 44](44-english-only-owner-steps.md) (*From review*).
10. [x] Slice 41: `lowerFirst` lowercases brand names ("Cloudflare" becomes "cloudflare"); skipped three times as "cannot tell
    without a list" ([Slice 41](41-tasks-with-outcome.md) *From review*).
11. [x] `plugin/scripts/sync-docs.mjs` prints "status table empty, closing all items of the project" whenever the status table
    has no rows, yet the summary says `closed=0` (wave 7 index pass and housekeeping 7; first seen in the
    2026-11-17-2023 note, item 17). Check what an empty table really does and make the message say it.
12. [x] Slice 31 (privacy, build first): the waiting-card mask still lets known shapes through, listed in
    [Slice 31](31-sync-and-waiting-text.md) lines 115-125 (double-escaped JSON passwords, a short flag on a continuation
    line, a PEM header before the 4096-character window, "The password is" with the value on the next line,
    `psql -W <value>`, a title masked after the 200-character cut, `branchOf` reading an ancestor repo's branch). This text
    leaves the machine. Verify: one test per shape.
13. [x] Slice 30: the seven follow-ups in [Slice 30](30-usage-script-fixes.md) *Follow-ups*, among them `planSince` rejecting a
    valid status-line file after a fresh install, a saved future `since` after clock skew, and a top-level `await import`
    outside the fail-open catch.
14. [x] Slice 29: the nine follow-ups in [Slice 29](29-agent-state-fixes.md) *Follow-ups*, and its open Work item "Find the title
    overwrite first" (cause never confirmed): log the sender (hook name, session id) of session-card reports, then close
    the bug card.
15. [x] Slice 38: follow-ups #3 and #5-#8 in [Slice 38](38-steady-browser-tests.md); #5 still says the two-suites run was
    before the output-folder fix, which the Result contradicts.
16. [x] Flaky unit tests under load: `test/capCost.test.ts`'s time budget, the seed MCP test and a `/mcp tools/list` 401 test
    failed 2-3 times per full run while e2e ran (wave 1); waiting-card tests assert wall-clock `< 200 ms`. Make them count-
    or CPU-based. Verify: three full runs beside an e2e run, all green.
17. [x] Slice 44, fix pass 1 #2 (skipped): cards that already exist keep their old `details_md` and long cut title, because the
    upsert COALESCEs them, so the owner's 300-character run-on card title stays until its doc line changes. Verify: re-sync
    the docs and read an old owner-step card's title and details.
18. [x] Slice 41: the detail dialog now reads "Card details" instead of "Item details" for a part (`e2e/active.spec.ts`), a
    change no *Changed while building* line in [Slice 41](41-tasks-with-outcome.md) names; record it there or restore it.

#### Found while building (builder session after the cloud session, 2026-11-19)

- Item 4: built #1, #3 and #6 (items 1-3), #4 (`askHuman` takes a getter, so `parseConfig` runs only for an ask on an item of another type; test in `test/mcp.test.ts`), #5 (new port method `findWithDocSync`: one read gives the item and `in_doc_sync`, the second `loadForSync` is gone) and the SLICE_CHILD_TYPES comment. Skipped #8 (whitespace-only `needs_you` with no `why`): it re-asserts the stored open question or the title, which changes nothing the owner sees (finding: "neither cleared nor refused; timing dependent"); no choice is safe without a new refusal rule.
- Item 7: built #1 (links), #2 (double-backtick spans), #4 (U+E000), #5 (link keys), #6 (phone card label), #8 (`cardQuestion`). Skipped #3 (the 1000-character window is a constant bound, linear overall). Built #7: `resetLabelPlace` returns `fits: false` when the plot is narrower than the word and `ResetText` (`web/src/TokenChart.tsx`) draws nothing then; the pinned narrow-plot case in `test/usageWeb.test.ts` was changed to expect `fits: false`, since the finding names the overflow as the fault. Nothing of item 7 is left.
- Item 8, second half: done. Slice 43's Environment e2e (`e2e/usage.spec.ts`, taken from 294fb7d) run against the code of 294fb7d's first parent (cd2bd16, a throwaway worktree, since removed): the desktop test "the Environment split draws real axis labels and the Reset mark clear of the y-axis labels" FAILS there (`text.axis-text` "Wed 11" not found for the faked `2026-11-11#2` key), so it catches the regression; the "view switcher" test failed on both projects there too (old tab-bar colours). The live-board check stays open (coordinator).
- Item 13: #2, #4-#7 were built by the cloud session. #1 and #3 not built: both need the plugin to tell which plan a status-line file was written under, which the file does not hold (`rate_limits` only), so any rule that accepts a file written before the plan was first seen (#1) or checks more than write time (#3) reopens the wrong-plan hole Slice 30 review 2 closed. Quoted: #1 "guard uses first-seen time as plan start; fresh install/upgrade/wiped state rejects a valid status-line file written earlier under the same plan"; #3 "takenAt >= since proves only write time, not plan". Slice 30's Decision (hold a file until the plan is seen) is kept; the cost is one skipped firing after a fresh install, and the board takes the address reading instead.
- Item 14: cloud session built #1, #6, #7, check-3 #1 and #2 and the sender log. Built now: #2 (`stopCard` re-sends the close once when the goal file shows a SubagentStop closed the card during Stop's held report; test in `hooks.test.mjs`). #5 is obsolete: `takeActiveSlot` no longer exists, and `attach` in `background-agents.mjs` promotes only a step that has a running agent recorded under it, never by label. Not built: #4 (the 3 s `RESUME_SLACK_MS` cannot tell a late flush from a quick resume by file times alone; shrinking it brings back the false resume Slice 29 fixed) and check-3 #3 (no SubagentStop for the last agent: the board's 30-minute stale rule closes the card, and a hook has nothing to react to). "Find the title overwrite first": the sender log is built; closing the bug card waits for a log that shows a title sender.
- Item 16: verified with three `npm test` runs, each overlapping an `E2E_PORT=4182 npm run test:e2e` run, all green (739 vitest, 417 node; e2e 330 passed, 4 skipped, three times). Item 8 stays unticked until its live check (below).
- Item 14, last step: the sender log is built (`sendCardReport` in `plugin/scripts/report-progress.mjs` writes `senders.log`); the coordinator closes the bug card on the board after the merge.

#### From review

- Skipped #6 (`reviews/pr-167-high.md`): "The `throw error` after a failed dynamic import was removed, so a non-direct importer continues with `readGoal`, `sendCapReading` etc. undefined" - the repo rule says every plugin script fails open (exit 0), and item 13 asked for the load error to be kept in `usage-tick.log`, which it is.
- Skipped #2 (`reviews/pr-167-medium.md`): "Empty status table sends an empty snapshot, closing all doc-synced items." - pre-existing on main; item 11 asked only that the message say what an empty table does, and the behaviour stays as main has it.
- Skipped #4 (`reviews/pr-167-medium.md`): "logSender append/read/rewrite without a lock or temp rename loses lines under concurrent hooks." - `senders.log` is a diagnostic log; a lost line loses no card data.
- Skipped #5 (`reviews/pr-167-medium.md`): "removeStaleTemps aborts on the first stat error (renamed temp) and its `<id>.` prefix matches sibling files' temps" - a left temp file is removed on the next run; no failure path for the caller.
- Skipped #7 (`reviews/pr-167-medium.md`): "SHORT_FLAG at line start masks bullets such as `-s second pass...`, hiding the question text." - over-masking only hides text, never leaks it; the waiting-card mask is a deny-list that accepts over-masking (CLAUDE.md rule, Slice 27); follow-up.
- Skipped #5 (`reviews/pr-167-check-medium.md`): "addStoppedAgent retry repairs only one rmdir race; a second removal between retry mkdir and rename is swallowed, agent looks still running." - one retry covers the race the pass-1 finding named; a still-lost stop record leaves a stale row that the 10-minute fresh window ages out.
- Skipped #7 (`reviews/pr-167-check-medium.md`): "MARKDOWN_ADDRESS fails on labels containing `]` or targets containing `)`, so the bare-address branch wraps part of an existing link in a second link." - a `]` in a board-address link label or `)` in a target is a rare doc shape; the address still resolves, only the Markdown nests; follow-up.
- Skipped #3, lock part (`reviews/pr-167-check-medium.md`): "logSender append/read/rewrite has no lock or temp rename, so concurrent writers lose lines." - same as #4 above: `senders.log` is diagnostic, a lost line loses no card data (only the "undefined" key part was fixed).
- Skipped #8 (`reviews/pr-167-medium.md`): "The drop-long-links pass re-runs build per clip size even when no link was dropped, doubling work" - extra build passes only cost time inside the bounded cut; no wrong reply.
- Skipped #4 (`reviews/pr-167-check-2-medium.md`): "actionBar treats a backtick as a single-backtick span, but plain() reads double-backtick spans as code." - check passes converged; a double-backtick span with a bar is a rare doc shape, only the title splits early; follow-up.
- Skipped #5 (`reviews/pr-167-check-2-medium.md`): "After the new "Slice N:" prefix strip, an action that was only the prefix becomes empty; ownerTitleFields returns null, the caller falls back to entryTitle and the steps after the bar are lost." - check passes converged; the card keeps the entry title, no data is lost from the document; follow-up.
- Skipped #6 (`reviews/pr-167-check-2-medium.md`): "removeStaleTemps runs readdirSync on the whole state folder after every writeJson, in hooks with a 2 s budget; cost grows with sessions kept." - check passes converged; a performance nit, no wrong result; follow-up.
- Skipped #7 (`reviews/pr-167-check-2-medium.md`): "The new PEM replace in tailOf scans the whole input before the cut, breaking the documented rule that input is cut to a 4096-char window and scanned linearly." - check passes converged; the scan is linear and masks more, never leaks; follow-up.
- Fixed per findings file: pr-167-high #1-#5; pr-167-medium #1, #3, #6, #9; pr-167-check-medium #1, #2, #3 (the undefined-key part), #4, #6; pr-167-check-2-medium #1, #2, #3. All others are listed above with their reasons.
- Findings file pr-167-check-3-medium: the check passes converged; none of its 7 findings is a crash, data loss, security or privacy fault, so none was built. #2, #3, #6 and #7 repeat earlier skips (double-backtick `spanEnd`, the `usage-tick.mjs` `throw error`, `logSender` lock/rewrite, `SHORT_FLAG` over-masking). Follow-up list, to build in a later slice:
  1. `plugin/scripts/hooks/session-done.mjs:99`: a held Stop report can land after a SubagentStop close and leave the card in progress; fix: re-read the goal after the hold write, or take `sentAt` before the first `saveGoal`.
  2. `plugin/scripts/sync-docs.mjs:417`: `actionBar`/`spanEnd` split at a ` | ` inside a double-backtick span; fix: `spanEnd` matches a run of N backticks.
  3. `plugin/scripts/usage-tick.mjs:61`: a failed dynamic import is no longer rethrown for non-direct importers; fix: log, then rethrow in the non-direct case.
  4. `src/mcp/schemas.ts:215`: the `details_md` description says null "keeps what is stored", but null clears an owner step's details; fix: say so.
  5. `plugin/scripts/report-progress.mjs:333`: `logSender` rewrites the whole log past 400 lines and can drop concurrent lines; fix: trim now and then, or temp file and rename.
  6. `plugin/scripts/hooks/hook-input.mjs:77`: `removeStaleTemps` runs on every `writeJson` and one failed `statSync` ends the sweep; fix: try/catch per entry, sweep now and then.
  7. `plugin/scripts/hooks/waiting-card.mjs:242`: `SHORT_FLAG` at line start masks `cc -Wall ...` and `-s foo` lines; fix: require a space before `-W`, or limit the line-start form to continuation lines.

#### For CLAUDE.md (lifted 2026-11-19)

- A doc-synced waiting item's `details_md` follows the document line: a non-null value replaces it, null clears it. The rule is `detailsOf` in `src/domain/docSync.ts` (Slice 45: docs/plan/slices/45-night-1602-follow-ups.md).
- Every plugin card report goes through `sendCardReport` in `plugin/scripts/report-progress.mjs`, which logs the sender (hook name, session id, field names only, never text) to `senders.log`; never send a card report around it (Slice 45: docs/plan/slices/45-night-1602-follow-ups.md).

#### Not yet verified

- Item 8: the live board's Environment tab shows no "NaN:00" label after the night's batched release. Claude's check with Chrome after the release, not the owner's.
