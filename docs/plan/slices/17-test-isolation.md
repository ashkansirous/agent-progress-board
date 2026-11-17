### Slice 17 — Parallel worktrees do not share an e2e server, and scratch scripts do not fail lint

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

- [ ] Take the e2e port from an env var (`E2E_PORT`), default 4173, and set `reuseExistingServer` to false so a run
  never attaches to a server it did not start; `--strictPort` then fails loudly on a busy port. Verify: two
  `npm run test:e2e` runs at once in two worktrees, the second with `E2E_PORT=4174`, both green; a second run on a
  busy port fails at start with the port message, not with test failures.
- [ ] Add `tmp/**` to the ignores in `eslint.config.js`. Verify: a file with a lint error under `tmp/` leaves
  `npm run lint` green.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` green.
