### Slice 43 — Owner steps on the board read right: real links, intact names, no needless questions

*Planned 2026-11-18. The owner, at the board's "Needs you · 4" list: "what the fuck are these 4?"* What the screenshot
showed, read against `origin/main`:
- Every card is labelled "Question" (`questionLabel`, `web/src/strings.ts:286`), but three are steps for the owner, not
  questions.
- Two steps read `<board address>/#/setup` and `<board address>/#/usage`: the public repo cannot hold the host name, so
  the plan writes a placeholder, and the card shows it unresolved instead of a link.
- The cloud step reads `AGENTBOARDURL`: the doc sync's `plain` (`plugin/scripts/sync-docs.mjs:103-104`) strips every
  `_`, `*` and backtick, so names inside code spans lose their underscores.
- The fourth card asked which phone mock wins for the Usage tab bar, which the newer mocks already settle (Slice 36,
  *Settled*).
- Also open: the Usage page's Environment tab shows "NaN:00" axis labels and "Reset" over the axis (bug card
  `agent-progress-board/bug-usage-env-axis-nan`; `bucketLabel`, `web/src/usageFormat.ts:64-68`).

**Touches:** `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`, `web/src/strings.ts`, the card and
drawer components that draw an owner step (`web/src/`), the Usage page's tab bar component, `web/src/usageFormat.ts`,
`web/src/chartGeometry.ts`, `test/` and `e2e/` files for each, `docs/plan/slices/43-owner-cards-read-right.md`

**Migrations:** none

#### Decisions

- `plain` keeps the text inside backticks as it is (underscores and all) and strips only Markdown emphasis outside
  them. Tests: `AGENT_BOARD_URL` in backticks comes through unchanged; `**You:**` still reads as the owner marker.
- The page replaces the literal `<board address>` in any card text with the page's own origin
  (`window.location.origin`) and makes `<origin>/#/...` a link. The host name never enters the repo or the stored item;
  the page knows its own address at read time.
- An owner step (a `**You:**` line) is labelled "Your step", not "Question". A real question keeps "Question".
- The Usage page draws the phone tab bar at the top, like Board and Active work (`PhoneV2`, `ActiveV3Phone`); move the
  test at `e2e/usage.spec.ts:200` with it.
- `bucketLabel` never prints "NaN": find the bucket key the Environment tab passes, label it right, and add a test for
  every key shape the chart can get. "Reset" moves clear of the y-axis labels, as in the usage mock in `docs/design/`.

#### Work

- [ ] `plain` keeps code spans; sync-docs tests.
- [ ] `<board address>` becomes the page's origin as a link; component test and e2e.
- [ ] "Your step" label for owner steps; strings and e2e.
- [ ] Usage tab bar at the top on the phone; e2e.
- [ ] Environment tab axis labels and the "Reset" position; unit tests for `bucketLabel`, e2e on the Environment tab.

#### Verification

- [ ] After the release and one doc sync, "Needs you" shows the owner steps labelled "Your step", with working links
  to the setup and usage pages and `AGENT_BOARD_URL` spelled in full.
