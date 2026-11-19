### Slice 45 — Review follow-ups left open by the night 2026-11-18-1602

*In progress (wave 2026-11-19), draft PR.* *Planned 2026-11-19 by the feedback loop ([note](../notes/2026-11-18-1602-feedback-loop.md)).*

*Settled 2026-11-19 by the starter session, under the owner's standing rule (no review or approval round; 2026-11-18:
"you should not fucking wait for my fucking review"): build every item below, item 12 (privacy) first, then 1-3. An
item whose fix needs a choice the slice files leave open takes the option that keeps the shown behaviour closest to
the slice's own Decision and records it under* Found while building. *Item 8's live check is Claude's (Chrome), not
the owner's.*

**Touches:** `src/mcp/tools.ts`, `src/application/board.ts`, `src/domain/upsert.ts`, `src/domain/docSync.ts`, `src/api/board.ts`, `src/api/access.ts`, `src/infrastructure/d1Repository.ts`, `plugin/scripts/sync-docs.mjs`, `plugin/scripts/cap-reading.mjs`, `plugin/scripts/usage-tick.mjs`, `plugin/scripts/hooks/waiting-card.mjs`, `plugin/scripts/hooks/session-waiting.mjs`, `plugin/scripts/hooks/background-agents.mjs`, `plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/hooks/goal-reminder.mjs`, `web/src/cards.ts`, `web/src/SessionCards.tsx`, `web/src/SessionDrawer.tsx`, `web/src/Detail.tsx`, `web/src/chartGeometry.ts`, `web/src/usage*`, `docs/clients.md`, `docs/plan/unverified.md`, `docs/plan/slices/38-steady-browser-tests.md`, `docs/plan/slices/41-tasks-with-outcome.md`, `e2e/active.spec.ts`, `e2e/usage.spec.ts`, `e2e/usageFixture.ts`, `e2e/loadingClock.ts`, `test/mcp.test.ts`, `test/board.test.ts`, `test/upsert.test.ts`, `test/access.test.ts`, `test/capCost.test.ts`, `test/seed.test.ts`, `test/oauth.test.ts`, `test/sessionWeb.test.ts`, `test/loadingDelay.test.ts`, `test/syncSnapshot.test.ts`, `test/docSync.test.ts`, `plugin/scripts/sync-docs.test.mjs`, `plugin/scripts/cap-reading.test.mjs`, `plugin/scripts/usage-tick.test.mjs`, `plugin/scripts/hooks/hooks.test.mjs`, `plugin/scripts/hooks/waiting-card.test.mjs`

*Touches widened at the claim (wave 2026-11-19) from a ground-in-code check at origin/main c765de1: all 18 items still open; item 2's code moved to `src/application/board.ts:182`; item 11's message prints only for a header-only table (`sync-docs.mjs:790`); item 17: only `details_md` is COALESCEd (`d1Repository.ts:244`), the title already refreshes.*

**Migrations:** none

#### Why

The night's slices merged with review findings written only as follow-ups inside their own slice files. plan.md's
*Outstanding work* has lines for Slices 33 to 36, 39, 40 and 41, but none for 32, 37, 42, 43 and 44, and three of the
Slice 32 findings are medium correctness faults. This slice gathers them so none is lost.

#### Work (each item names where it came from; the slice files hold the full text)

1. Slice 32, check pass 3 (medium): a clipped oversize `list_open`/`get_item` reply cuts `links[].url` and returns a
   broken URL (`src/mcp/tools.ts:49`, not re-read here). Verify: a test with an item whose links push the reply over
   50,000 characters gets whole URLs or none.
2. Slice 32, check pass 3 (medium): `ask_human` sends `after_answer ?? null`, which erases a stored `after_answer` on a
   re-ask (`src/application/board.ts:113`, not re-read here). Verify: a re-ask without `after_answer` keeps the stored one.
3. Slice 32, check pass 3 (medium): `fitItem` can fall back to a bare `{key}` for a huge item (`src/mcp/tools.ts:144`).
   Verify: a huge item keeps its title and status in the cut reply.
4. Slice 32, the other five check-pass-3 findings: see "Follow-up from check pass 3" in
   [Slice 32](32-questions-and-rules.md).
5. Slice 37: the five lows under "Follow-up list (low, not built)" in [Slice 37](37-access-and-grants.md).
6. Slice 42: `docs/clients.md` does not describe the `built` grouping ([Slice 42](42-built-not-in-progress.md)).
7. Slice 43: the phone card shows the project name, not "Your step" (check pass 2 #6; the Decision says "Your step"),
   plus the other check-pass-2 lows and skipped #9 in [Slice 43](43-owner-cards-read-right.md).
8. Slice 43: the live "NaN:00" on the Environment tab was never reproduced; only `bucketLabel` was hardened. Verify on the
   live board after the release (line in `docs/plan/unverified.md`).
   Also: Slice 43's new Environment e2e (the faked `2026-11-11#2` key) was never run against the old code, so it is not
   shown to catch the regression; run it on the commit before PR #156 and record the failure.
9. Slice 44: the three check-pass lows in [Slice 44](44-english-only-owner-steps.md) (*From review*).
10. Slice 41: `lowerFirst` lowercases brand names ("Cloudflare" becomes "cloudflare"); skipped three times as "cannot tell
    without a list" ([Slice 41](41-tasks-with-outcome.md) *From review*).
11. `plugin/scripts/sync-docs.mjs` prints "status table empty, closing all items of the project" whenever the status table
    has no rows, yet the summary says `closed=0` (wave 7 index pass and housekeeping 7; first seen in the
    2026-11-17-2023 note, item 17). Check what an empty table really does and make the message say it.
12. Slice 31 (privacy, build first): the waiting-card mask still lets known shapes through, listed in
    [Slice 31](31-sync-and-waiting-text.md) lines 115-125 (double-escaped JSON passwords, a short flag on a continuation
    line, a PEM header before the 4096-character window, "The password is" with the value on the next line,
    `psql -W <value>`, a title masked after the 200-character cut, `branchOf` reading an ancestor repo's branch). This text
    leaves the machine. Verify: one test per shape.
13. Slice 30: the seven follow-ups in [Slice 30](30-usage-script-fixes.md) *Follow-ups*, among them `planSince` rejecting a
    valid status-line file after a fresh install, a saved future `since` after clock skew, and a top-level `await import`
    outside the fail-open catch.
14. Slice 29: the nine follow-ups in [Slice 29](29-agent-state-fixes.md) *Follow-ups*, and its open Work item "Find the title
    overwrite first" (cause never confirmed): log the sender (hook name, session id) of session-card reports, then close
    the bug card.
15. Slice 38: follow-ups #3 and #5-#8 in [Slice 38](38-steady-browser-tests.md); #5 still says the two-suites run was
    before the output-folder fix, which the Result contradicts.
16. Flaky unit tests under load: `test/capCost.test.ts`'s time budget, the seed MCP test and a `/mcp tools/list` 401 test
    failed 2-3 times per full run while e2e ran (wave 1); waiting-card tests assert wall-clock `< 200 ms`. Make them count-
    or CPU-based. Verify: three full runs beside an e2e run, all green.
17. Slice 44, fix pass 1 #2 (skipped): cards that already exist keep their old `details_md` and long cut title, because the
    upsert COALESCEs them, so the owner's 300-character run-on card title stays until its doc line changes. Verify: re-sync
    the docs and read an old owner-step card's title and details.
18. Slice 41: the detail dialog now reads "Card details" instead of "Item details" for a part (`e2e/active.spec.ts`), a
    change no *Changed while building* line in [Slice 41](41-tasks-with-outcome.md) names; record it there or restore it.
