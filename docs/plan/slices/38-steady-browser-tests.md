### Slice 38 — Browser tests that don't flake

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 1, first, because every later wave's full e2e run
pays for these flakes.

**Touches:** `playwright.config.ts`, `e2e/port.ts` (new), `e2e/board.spec.ts`, `e2e/active.spec.ts`,
`e2e/usage.spec.ts`, `scripts/seed.ts`, `test/seed.test.ts`, `test/e2ePort.test.ts` (new),
`docs/plan/slices/38-steady-browser-tests.md`

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

- [ ] The Retry test (`e2e/board.spec.ts:~371-381`), and the same pattern at `:407-413` and `:447-451`: use a held
  route and the page clock.
- [ ] `e2e/active.spec.ts:211-218`, the loading card: the same fix.
- [ ] `e2e/board.spec.ts:218-231`, the close button, Escape, scrim and focus test: there is no explicit timing, and
  the cause is unproven (likely a click or focus race after a rerender). Run it 50 times with `--repeat-each=50`.
  If it fails, fix the race. Either way, write the result here.
- [ ] Slice 10 check-2 #4: `expect(page.url())` doesn't retry (`e2e/board.spec.ts:332`; `active.spec.ts:180,200`).
  Use `expect(page).toHaveURL`.
- [ ] Slice 10 check-3 #2: the row-gap assertion hard-codes 14 for the empty card only (`active.spec.ts:76`), and the
  error card is untested.
- [ ] Slice 26 chk #2: the weak assertion at `e2e/usage.spec.ts:280-288`.
- [ ] Slice 17: move `resolvePort` (`playwright.config.ts:8-15`) to `e2e/port.ts` (new) and test a bad `E2E_PORT` in
  `test/e2ePort.test.ts` (new).
- [ ] Slice 13 check pass 3: six lows in `scripts/seed.ts` were never traced. Read them in
  `docs/plan/slices/13-session-cards.md`, then fix each or write why not.

#### Verification

- `npm run test:e2e -- --repeat-each=20` on the changed specs passes with no failure. Then two full suites at once,
  each with its own `E2E_PORT` and default workers, pass three times in a row. Write the run counts here.
- `npm test` covers `test/e2ePort.test.ts`.
