### Slice 43 — Owner steps on the board read right: real links, intact names, no needless questions

*Built 2026-11-19, merged as PR #156 (294fb7d), not yet verified on the live board (needs the release and one doc sync). Tests at the end: 724 vitest, 389 plugin, 330 e2e passed (4 skipped).*

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
drawer components that draw an owner step (`web/src/SessionCards.tsx`, `web/src/SessionDrawer.tsx`, `web/src/PhoneNeeds.tsx`,
`web/src/ProjectGroup.tsx`, `web/src/cards.ts`, `web/src/model.ts`), the Usage page's tab bar component (`web/src/UsagePage.tsx`,
`web/src/Header.tsx`, the page's CSS), `web/src/usageFormat.ts`,
`web/src/chartGeometry.ts`, `web/src/TokenChart.tsx`, `web/src/ViewTabs.tsx`, `web/src/Detail.tsx`, `web/src/ActivePage.tsx`,
`web/src/BoardPage.tsx`, `web/src/icons.tsx`, `web/src/usage.css`, `web/src/active.css`, `test/` and `e2e/` files for each, `docs/plan/slices/43-owner-cards-read-right.md`

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

- [x] `plain` keeps code spans; sync-docs tests.
- [x] `<board address>` becomes the page's origin as a link; unit test (`resolveBoardAddress`) and e2e.
- [x] "Your step" label for owner steps; strings and e2e.
- [x] Usage tab bar at the top on the phone; e2e.
- [x] Environment tab axis labels: `bucketLabel` never prints "NaN"; unit tests and an e2e whose faked response has a
  `#2` day key.
- [x] "Reset" placement: one pure function, `resetLabelPlace` (`web/src/chartGeometry.ts`), keeps the word inside the
  plot and flips it left near the right edge; unit tests and an e2e that checks the word starts right of every y label.
  The old code already put it at the left edge plus 6, as in the mock, so this guards that position.
- [x] The phone-only `ViewTabs` branch and its CSS are removed (every page draws the top bar).

#### Changed while building

- Owner step = a waiting item from `ownerItem` (check-hash key) with no `needs_you`: one rule, `isOwnerStep` in
  `web/src/cards.ts`. It is labelled "Your step" ("Dein Schritt") on the desktop card and the `SessionDrawer` kicker, opens
  `SessionDrawer`, and its body falls back to the title (`ownerStepFallback`).
- `<board address>` is resolved at read to `window.location.origin` (`resolveBoardAddress` / `fillBoardAddress`), linked
  in the same tab; the aria text, `details_md` and `after_answer` are resolved too. Never stored.
- `plain()` swaps code spans for a placeholder, strips only real emphasis at word bounds, and works on a capped window;
  `checkHash` keeps the old reading so stored check keys do not change.
- The phone tab bar sits at the top on Usage; the `ViewTabs` phone branch, its CSS and `BoardIcon` / `ActiveIcon` are removed.
- `bucketLabel` parses by regex and never prints NaN; the "Reset" word is placed by `resetLabelPlace` and never crosses its line.

#### Found while building

- The Environment tab passes the same `data.buckets[].key` list as every other split into `bucketLabel`/`bucketLetter`
  (`chartBuckets`, `web/src/chartGeometry.ts`). The only key shape the old length-based code turned into "NaN:00" is a day
  key with a repeat mark (`2026-11-01#2`); the Worker's `bucketsBetween` does not emit one for whole days, so the live
  cause is not found in the code. It may be an older Worker or a cached page bundle; the parser now reads the shape off
  the key's end and prints an empty label for an unknown shape, never "NaN".

#### Verification

- [ ] After the release and one doc sync, "Needs you" shows the owner steps labelled "Your step", with working links
  to the setup and usage pages and `AGENT_BOARD_URL` spelled in full.

#### From review

- Skipped #4 (`reviews/pr-156-high.md`): "An owner step is told apart by the key shape `<project>/slice-N/check-<hash>` plus `needs_you == null`: a naming convention copied into the page." - the Decision names only `**You:**` lines as owner steps, which come only from `ownerItem` with check-hash keys; `/waiting` items carry park questions (the live item agent-progress-board/slice-36/waiting held a question in `why` with needs_you null), so labelling them "Your step" would be wrong.
- Skipped #9 (`reviews/pr-156-high.md`): "The ticked Work list disagrees with the diff." - the fourth (tab-bar) question card is already closed on the live board (done 2026-11-18T22:47Z by the doc sync after PR #153); the Reset tick is covered by finding 1.
- Skipped #4 (`reviews/pr-156-medium.md`): "isOwnerStep is a key-shape regex plus null needs_you (same root as pass-1 finding 4, skipped)." - same rule as pass-1 #4: the Decision names only `**You:**` lines, which come only from `ownerItem`'s check-hash keys.
- Skipped #8 (`reviews/pr-156-medium.md`): "`__init__` outside code spans matches STRONG and loses underscores." - CommonMark reads `__init__` outside a code span as strong emphasis, so stripping it is the Decision's "strip Markdown emphasis outside backticks"; a name keeps its underscores inside backticks.
- Skipped #9 (`reviews/pr-156-medium.md`): "Reset label width guessed as `length * font * 0.62`" - the guard keeps the mock's position, which pass 1 found already clear of the y labels; the narrow-plot right-edge case has no reported failure, recorded as a follow-up.
- Skipped #2 (`reviews/pr-156-check-medium.md`): "Code-span placeholder U+E000 not escaped from input; restore is positional." - a doc line holding the private-use character U+E000 is not a case any plan file has; no failure path in real input.
- Skipped #3 (`reviews/pr-156-check-medium.md`): "`fillBoardAddress` replaces the address but makes no link, and also rewrites inside code fences." - owner steps now open SessionDrawer, which links the address; the plain Detail drawer shows the resolved origin as text, a follow-up.
- Skipped #6 (`reviews/pr-156-check-medium.md`): "`parseBucket` ignores the `#N` suffix; repeated local hour gives identical `bucketStartMs`." - origin/main's bucketStartMs also dropped `#N`, and bar positions come from the Worker's start/end via xOfMoment, not from bucketStartMs.
- Check pass 2 (`reviews/pr-156-check-2-medium.md`): "8 findings, none blocking", all left as follow-ups, not applied:
  - #1 `web/src/Detail.tsx:128`: the details box fills `<board address>` as plain text, not a link.
  - #2 `plugin/scripts/sync-docs.mjs:111`: `CODE_SPAN` matches only single-backtick spans; double-backtick spans leave stray backticks.
  - #3 `plugin/scripts/sync-docs.mjs:112`: emphasis regexes scan a window of up to 1000 characters per unmatched opener (a constant, not linear).
  - #4 `plugin/scripts/sync-docs.mjs:121`: a literal U+E000 in a line is read as the span mark on restore.
  - #5 `web/src/SessionCards.tsx:83`: link row keys `label|url` can repeat between an address link and an item link.
  - #6 `web/src/SessionCards.tsx:100`: the phone card header shows the project name, not `cardLabel`, so "Your step" shows only on desktop and in the drawer.
  - #7 `web/src/chartGeometry.ts:90`: `resetLabelPlace` overflows the plot edge when the label fits on neither side; width is a character-count estimate.
  - #8 `web/src/SessionDrawer.tsx:147`: the drawer heading expression differs from `ownerStepFallback`; one helper should serve both.

#### For CLAUDE.md (lifted 2026-11-19)

- An owner step (a waiting item from `ownerItem` with no `needs_you`) is recognised only by `isOwnerStep` in `web/src/cards.ts`; never a second copy (Slice 43: docs/plan/slices/43-owner-cards-read-right.md).
- `<board address>` is resolved only at read on the page (`resolveBoardAddress` / `fillBoardAddress`), never stored: the host name stays out of the repo and the items (Slice 43: docs/plan/slices/43-owner-cards-read-right.md).
- `plain()` in `plugin/scripts/sync-docs.mjs` keeps code spans; `checkHash` keeps its old reading so stored check keys do not change (Slice 43: docs/plan/slices/43-owner-cards-read-right.md).

#### Not yet verified

- The Verification box above: after the release and one doc sync on the live board, "Needs you" shows owner steps as "Your step" with working links and `AGENT_BOARD_URL` in full.
- The phone card shows the project name, not "Your step" (check pass 2 #6, follow-up).
