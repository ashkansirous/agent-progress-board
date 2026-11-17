### Slice 17 — Parallel worktrees do not share an e2e server, and scratch scripts do not fail lint

*Built 2026-11-17, PR #90 merged.*

*Planned: the owner's go on 2026-11-17 ("yes put slice 17 to fix the fucking board"). Found by the feedback loop of
night 2026-11-17-1216 ([note](../notes/2026-11-17-1216-feedback-loop.md)).* Test tooling only, no product change.
Entry numbers are from that loop's digest.

**Touches:** `playwright.config.ts`, `eslint.config.js`, `package.json`, `docs/plan/slices/17-test-isolation.md`

**Migrations:** none

#### Why

- Two worktrees ran `npm run test:e2e` at once. `playwright.config.ts` fixes `PORT = 4173` with
  `reuseExistingServer: !process.env.CI`, so Slice 16's suite attached to Slice 15's dev server and failed 179
  tests that all passed alone (entries 970-976, 1061). A suite can as well pass against the wrong code.
- A device-test agent wrote a throwaway script under the worktree's `tmp/`; `eslint.config.js` does not ignore
  `tmp/` (only `.gitignore` does), so `npm run lint` failed with 11 errors on a clean slice (entries 1003-1011).

#### Work

- [x] Take the e2e port from an env var (`E2E_PORT`), default 4173, and set `reuseExistingServer` to false so a run
  never attaches to a server it did not start; `--strictPort` then fails loudly on a busy port. Verify: two
  `npm run test:e2e` runs at once in two worktrees, the second with `E2E_PORT=4174`, both green; a second run on a
  busy port fails at start with the port message, not with test failures.
- [x] Add `tmp/**` to the ignores in `eslint.config.js`. Verify: a file with a lint error under `tmp/` leaves
  `npm run lint` green.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` green.

*Changed while building:* `playwright.config.ts` reads the port through `resolvePort`: `E2E_PORT` unset gives 4173;
an empty, non-integer or out-of-range (not 1-65535) value throws at config load with a clear message.
`reuseExistingServer` is false. `eslint.config.js` ignores `tmp/**`. `package.json` was not changed.

*Verified by the builder:* a busy 4173 fails at start with "is already used"; a file with a lint error under `tmp/`
leaves lint green; two suites at once (4173 and `E2E_PORT=4174`) each gave 239 passed, 3 skipped, but only with
`--workers=4`. Final: lint and typecheck clean, 465 unit tests, 239 e2e passed, 3 skipped. A shared `test-results/`
folder clashed only because both runs were in one worktree.

*From review:* findings files `reviews/pr-90-high.md` and `reviews/pr-90-medium.md` (all findings read).
- Applied high #1 (an empty or non-numeric `E2E_PORT` gave port 0 or NaN): `resolvePort` now throws a clear error.
- Skipped #2 (`reviews/pr-90-high.md`): "The isolation is opt-in: default stays 4173" - the slice's first Work line chose an opt-in `E2E_PORT` with default 4173; a collision now fails at start.
- Skipped #3 (`reviews/pr-90-high.md`): "Verify steps (two concurrent runs" - the runs are recorded above in this docs step.
- Skipped #4 (`reviews/pr-90-high.md`): "Touches lists `package.json`" - Touches is an upper bound, no change needed.
- Skipped #5 (`reviews/pr-90-high.md`): "E2E_PORT is not mentioned in CLAUDE.md's Commands section" - documented through the For CLAUDE.md block below.
- Skipped #1 (`reviews/pr-90-medium.md`): "E2E_PORT is documented nowhere" - documented through the For CLAUDE.md block below.
- Skipped #2 (`reviews/pr-90-medium.md`): "resolvePort throws on an empty E2E_PORT" - that throw is the applied high #1 fix.
- Skipped #3 (`reviews/pr-90-medium.md`): "The `tmp/**` ignore matches only a top-level tmp" - the slice asks for `tmp/**` at the repo root, where agents write scratch.

*Follow-up (not built):* timing-sensitive tests in `e2e/board.spec.ts` (4-5 of them) flaked when two full suites
shared the CPU at default workers; two suites at once need `--workers=4`.

*Follow-up (not built, feedback loop 2026-11-17-2023):* three more tests failed in full runs on night 2026-11-17-2023
and passed when rerun alone: `e2e/active.spec.ts:211` ("a wait over 500 ms shows the loading card"; wave 1 merged-main
run, Slice 26's run, Slice 28's fix pass 2), `e2e/board.spec.ts:218` (close button, Escape and scrim; it failed on
the unchanged baseline in the Slice 27 cloud run too) and `e2e/board.spec.ts:367`. Cause not proven. Verify: each passes
20 times in a row in a full `npm run test:e2e` at default workers on a quiet machine, or its timing window is fixed.

#### For CLAUDE.md (lifted 2026-11-17)

Under *Commands and layout*: a second `npm run test:e2e` alongside another worktree's sets `E2E_PORT` (e.g. 4174);
runs never reuse a server and a busy port fails at start; scratch files go under `tmp/`, which lint ignores
(Slice 17: docs/plan/slices/17-test-isolation.md).

#### Not yet verified

None.
