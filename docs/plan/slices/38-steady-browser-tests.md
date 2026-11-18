### Slice 38 — Browser tests that don't flake

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 1, first, because every later wave's full e2e run
pays for these flakes.

*Built (wave 2026-11-18), PR #132; code written by a cloud session.*

The code was first written by cloud run `cse_012UYzYTd3ysZ523gVcrF6zW` (commit a55276a); the cloud session reached
Chromium through `PLAYWRIGHT_BROWSERS_PATH` because the download was blocked.

**Touches:** `playwright.config.ts`, `e2e/port.ts` (new), `e2e/board.spec.ts`, `e2e/active.spec.ts`,
`e2e/usage.spec.ts`, `e2e/loadingClock.ts` (new), `scripts/seed.ts`, `test/seed.test.ts`, `test/e2ePort.test.ts` (new),
`test/loadingDelay.test.ts` (new), `docs/plan/slices/38-steady-browser-tests.md`

**Migrations:** none

#### Why

Timing-sensitive e2e tests fail in single full runs:
- `e2e/board.spec.ts`: the Retry test at about `:365-385` (still listed as `:317`/`:367` in plan.md), plus `:218`;
- `e2e/active.spec.ts:211`;
- more failures when two suites share the CPU.

Night 2026-11-17-2023 had three such failures (Slice 17 follow-up; Slice 2 follow-up #5; Slice 7 *Verification*).
Each of these tests waits on wall-clock windows: a route held for 1500 ms, `waitForTimeout(250)`, then
`toBeVisible({ timeout: 1000 })` against a 500 ms loading timer.

#### Decisions

- Replace wall-clock windows with Playwright's clock (`page.clock`) or with a route held by a promise the test
  releases. Never just raise a timeout. Check the clock API against context7 before writing it (global rule).
- The E2E mode stays only under the env flag `playwright.config.ts` sets (root `CLAUDE.md`, *No gate bypass*).

#### Work

- [x] The Retry test (`e2e/board.spec.ts:~371-381`), and the same pattern at `:407-413` and `:447-451`: use a held
  route and the page clock.
- [x] `e2e/active.spec.ts:211-218`, the loading card: the same fix.
- [x] `e2e/board.spec.ts:218-231`, the close button, Escape, scrim and focus test: there is no explicit timing, and
  the cause is unproven (likely a click or focus race after a rerender). Run it 50 times with `--repeat-each=50`.
  If it fails, fix the race. Either way, write the result here.
- [x] Slice 10 check-2 #4: `expect(page.url())` doesn't retry (`e2e/board.spec.ts:332`; `active.spec.ts:180,200`).
  Use `expect(page).toHaveURL`.
- [x] Slice 10 check-3 #2: the row-gap assertion hard-codes 14 for the empty card only (`active.spec.ts:76`), and the
  error card is untested.
- [x] Slice 26 chk #2: the weak assertion at `e2e/usage.spec.ts:280-288`.
- [x] Slice 17: move `resolvePort` (`playwright.config.ts:8-15`) to `e2e/port.ts` (new) and test a bad `E2E_PORT` in
  `test/e2ePort.test.ts` (new).
- [ ] Slice 13 check pass 3: six lows in `scripts/seed.ts` were never traced. Read them in
  `docs/plan/slices/13-session-cards.md`, then fix each or write why not. One is fixed (unique keys across all three
  lists, `test/seed.test.ts`). Five lows are left: seed test counts, empty fields sent as undefined, `ask_human` on an
  existing item, session cards going stale 15 min after seeding, hard-coded history markers. They all sit in
  `scripts/seed-data.ts` and go to the open slice whose **Touches:** holds `scripts/seed-data.ts` (task cards with an
  outcome).

#### Verification

- `npm run test:e2e -- --repeat-each=20` on the changed specs passes with no failure. Then two full suites at once,
  each with its own `E2E_PORT` and default workers, pass three times in a row. Write the run counts here.
- `npm test` covers `test/e2ePort.test.ts`.

#### Result (build)

- Clock: the loading-delay tests (`e2e/loadingClock.ts`, shared by both specs) install and pause `page.clock` before
  the page loads, hold the route on a promise, wait until the held request arrives (the page registers its 500 ms
  timer just before it sends it), then run the clock 499 ms (the card must be absent) and 1 ms (it must show); no
  wall-clock wait is left in them (board: Retry, loading, palette loading; active: loading card).
- The close test also asserts focus returns to the tile after Escape and after the scrim click (stricter than before).
- URL checks after a failed load wait for the error card and a rendered frame (`pageSettled`) before `toHaveURL`.
- Close test (`board.spec.ts`): it failed every time here, on the original code too. Cause is in the test: it sent
  Escape and the scrim click before the dialog had mounted, so "no dialog" passed against a dialog not yet open and
  the page stayed inert for the next click. Now each step waits for the dialog and the focus first. Repeat run:
  100 of 100 passed (50 per project).
- `toHaveURL` replaces `expect(page.url())`; the row-gap check names the empty card's `state-gap-14` and the error
  card is asserted at 12px; the mix-note test now checks each note sits on the first model's row.
- `resolvePort` moved to `e2e/port.ts`, tested in `test/e2ePort.test.ts`.
- Slice 13 seed lows (`scripts/seed-data.ts` is not on this slice's Touches line, so the data fixes are left):
  unique keys now checked across all three lists (fixed in `test/seed.test.ts`); the other five (seed test counts,
  empty fields sent as undefined, `ask_human` on an existing item, session cards going stale 15 min after seeding,
  hard-coded history markers) all sit in `seed-data.ts` and wait for a slice that touches it.
- Runs: the changed loading, Retry, empty/error card, mix-note and URL tests, 20 repeats on both projects: 720 of 720
  passed. The close test: 100 of 100. The two-suites-at-once run (three times) was not done in this session.
  The browser here was a pre-installed Chromium reached through `PLAYWRIGHT_BROWSERS_PATH`, since the download is blocked.
  The two-suites run is not run in the cloud; the coordinator runs it next.

- Two suites at once (coordinator, 2026-11-18, three rounds, ports 4174 and 4176, both projects, 263 tests each; logs
  in `reviews/38-e2e-runs/`, outside the repo): round 1 had 260 of 263 passed on 4174 (3 failed) and 263 of 263 on 4176;
  round 2 had 263 of 263 on 4174 and 262 of 263 on 4176 (1 failed); round 3 had 263 of 263 on both. Every failure was
  `browserContext.close: ENOENT ... test-results\.playwright-artifacts-*\traces`, not a test assertion. Cause: both suites
  wrote to the one `test-results/` of the worktree and Playwright cleans its output folder at the start, so one suite
  deleted the other's trace files. Fix: `outputDir: test-results/<port>` in `playwright.config.ts`, one folder per port
  (context7 `/microsoft/playwright`, `TestConfig.outputDir`).
- Two suites at once after the `outputDir` fix (coordinator, 2026-11-18, three rounds, ports 4174 and 4176): all six
  runs exit 0, 263 passed and 3 skipped each (logs `reviews/38-e2e-runs/after-r{1,2,3}-{4174,4176}.log`, outside the
  repo). This meets the Verification. Checks on the final tree with nothing else running: lint and typecheck exit 0;
  `npm test` exit 0 (501 vitest tests in 37 files, 278 node tests).
- Review fixes: the Retry test's timer check now compares the 500 ms timer count before and after the Retry click
  (`delayTimerCount`, `timersBefore` in `e2e/loadingClock.ts`), not a total above 0; the mix-note readiness wait counts
  the figure rows in every table that can hold a note.

#### For CLAUDE.md

- The e2e output folder is per port (`test-results/<port>` in `playwright.config.ts`), so two suites can run at once,
  even in one worktree. Loading-delay tests use the shared clock helper `e2e/loadingClock.ts` (clock installed before
  `goto`, the 500 ms timer counted per action); never a wall-clock wait.

#### Follow-ups

- Follow-up #4 (`reviews/pr-132-check-medium.md`): "e2e/loadingClock.ts:14, correctness: clock paused 1 s after
  SERVER_TIME skews page Date.now() against fixtures."
- Follow-up #5 (`reviews/pr-132-check-medium.md`): "docs/plan/slices/38-steady-browser-tests.md:61, other: deferred seed
  fixes name no slice; Verification (two suites x3) is unmet." The seed fixes in `scripts/seed-data.ts` go to Slice 41,
  "Only a task with an outcome gets a card" (planned; its Touches holds `scripts/seed-data.ts`). The two-suites x3
  Verification is met by the runs above, except that they ran before the `outputDir` fix.
- Follow-up #7 (`reviews/pr-132-check-medium.md`): "e2e/active.spec.ts:201, correctness: pageSettled then toHaveURL
  weakly guards against a later hash rewrite."
- Follow-up #8 (`reviews/pr-132-check-medium.md`): "e2e/loadingClock.ts:46, other: release() runs only after assertions;
  only the palette test uses try/finally, fulfil errors swallowed."

- Follow-up (`reviews/pr-132-check-2-medium.md` #3): "e2e/loadingClock.ts:25,83: timer counter counts any 500 ms
  setTimeout; count read once, not polled."
- Follow-up (`reviews/pr-132-check-2-medium.md` #5): "e2e/active.spec.ts:77: pins CSS class name, redundant with
  computed-style line."
- Follow-up (`reviews/pr-132-check-2-medium.md` #6): "e2e/usage.spec.ts:281: hard-coded two-table readiness wait."
- Follow-up (`reviews/pr-132-check-2-medium.md` #7): "test/loadingDelay.test.ts:4: regex on raw hooks.ts source,
  brittle to reformatting."
- `reviews/pr-132-check-2-medium.md` #1, #2 and #4 repeat follow-ups #7, #4 and #8 above; its #8 (two suites not rerun
  after the `outputDir` fix) is answered by the after-fix runs in the Result.

#### From review

- `reviews/pr-132-high.md` (8 findings): applied #1 (wait for the held request before the first `runFor`), #2 (a
  positive signal before each absence check), #3 (wait for the error card and a rendered frame before `toHaveURL`),
  #4 (Verification run; seed lows named to Slice 41), #5 (shared `e2e/loadingClock.ts`), #6 (release in `finally`),
  #7 (mix-note readiness wait); #8 has its own line below.
- `reviews/pr-132-medium.md` (7 findings): applied #1, #2, #3, #4, #5 and #7; #6 has its own line below.
- `reviews/pr-132-check-medium.md` (8 findings): applied #1 (timer count compared before and after the Retry click) and
  #6 (readiness wait counts rows in every table); #2 and #3 settled by the same change as #1; #4, #5, #7 and #8 are
  follow-ups above.
- `reviews/pr-132-check-2-medium.md` (8 one-line follow-ups, no findings): all recorded under Follow-ups.
- Skipped #8 (`reviews/pr-132-high.md`): "new `toBeFocused` assertions after the scrim click are not named in the slice Result" - not a fault: the added focus checks are stricter tests of the same flow, so they are described in the Result instead.
- Skipped #6 (`reviews/pr-132-medium.md`): "owner-row filter `has: notes` is wider than the count it pairs with; failure shows a confusing count" - the wider filter still counts exactly the rows the test asserts on, so no wrong pass follows from it.
