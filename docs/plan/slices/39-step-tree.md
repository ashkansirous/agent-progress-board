### Slice 39 — Steps are a tree: sub-steps unfold in place, and several can run at once

*Planned 2026-11-18. The owner's words (2026-11-18, looking at the Active work page):*
- *"I cannot click on the tab so that it would give me more details on it."*
- *"subs inside the parent's list. but it should be expandable."*
- *"several would be running at once. need better animation other than just highlight. maybe a rotation around the
  task number indicating that it is being worked on."*
- *"in place is good. tasks should be considered like a tree. the root is the main chat working on the slice. each
  sub would be a child node that can be expanded if it is not a leaf."*

Runs after Slice 32, because both edit `src/domain/steps.ts`, `src/mcp/schemas.ts`, `src/mcp/instructions.ts` and
`plugin/skills/agent-board/SKILL.md`. Slices 40 and 41 build on it.

**Touches:** `src/domain/steps.ts`, `src/domain/stepTypes.ts`, `src/domain/upsert.ts`, `src/mcp/schemas.ts`,
`src/mcp/tools.ts`, `src/mcp/instructions.ts`, `src/application/board.ts`, `plugin/skills/agent-board/SKILL.md`,
`docs/clients.md`, `web/src/stepsView.tsx`, `web/src/stepsText.ts`, `web/src/ActiveCard.tsx`, `web/src/strings.ts`,
`web/src/active.css`, `test/steps.test.ts`, `test/stepsTools.test.ts`, `test/mcpInstructions.test.ts`,
`test/pluginRules.test.ts`, `test/web.test.ts`, `e2e/active.spec.ts`, `e2e/activeFixture.ts`,
`plugin/scripts/report-progress.mjs`, `plugin/scripts/report-progress.test.mjs`, `src/infrastructure/d1Repository.ts`,
`src/api/boardDto.ts`, `web/src/**` (any reader of `Step`), `test/**` (step tests), `docs/plan/slices/39-step-tree.md`

*Built 2026-11-18 (night wave 3), merged as PR #143 (b0188dc); not yet verified on a phone or the deployed board.* Touches
widened at claim (premise check, wave 19): the plugin reporter
builds and forwards `steps` (`keepStep`, the step filter, `currentStep`), the repository stores and diffs them, the DTO
and `StepProgress.current` carry one label, and `progressOf` in `steps.ts` finds one active step. Widened again while
building: `src/domain/errors.ts`, `src/application/ports.ts`, `web/src/SessionDrawer.tsx`, `web/src/session.css`,
`e2e/session.spec.ts`, `e2e/parts.spec.ts`, `test/stepFixtures.ts`.

*Changed while building:*
- A step is `{id, label, state, note, started_at, done_at, children}`; depth 4, 200 steps in all; the one-active rule is
  gone; the server stamps times by id; old flat rows read as depth-1 trees. `StepProgress` gained `running`;
  `report_progress` gained `under_step`.
- Ids are resolved in two passes (`resolveIds`/`placeIds` in `src/domain/steps.ts`): explicit ids and kept children
  first, then generated ids, so the result does not depend on sibling order. Generated ids are cut to 80 characters with
  a hash tail. `checkSize` refuses oversized trees before any id work.
- Every write of `steps` (whole list or `under_step`) goes through one compare-and-swap path, `saveStepsReport` in
  `src/application/board.ts` (5 tries with short jitter, then a temporary "send again" refusal). The event row is
  inserted in the same D1 batch only `WHERE changes() > 0` (`src/infrastructure/d1Repository.ts`).
- A parent reported done finishes every descendant. A parent with a running leaf shows as running (`shownState`).
- Page: tree with path numbers, 26px indent, in-place boxes, a ring on every running step, no "Show all" toggle (the
  ActiveV3 mocks win; the older Active/PhoneActive mocks still draw one). The session drawer draws the same `StepRows`.
- Merged `main` (Slice 36) in: Slice 36's expand-state e2e test was dropped because the toggle is gone.
- Tests on the final code: 641 vitest, 341 plugin, 312 e2e, all green.

**Migrations:** none (steps stay JSON in `items.steps`)

#### Why

Today a card's steps are one flat list with at most one running step (`src/domain/steps.ts:33`), and a step row is
plain text with no tap action (`web/src/stepsView.tsx`). When nothing is marked running, the header says "Starting",
even with 26 of 30 steps done (`web/src/stepsText.ts:6-9`). A step that a sub-agent does ("Record audio, 15
languages") can't show that agent's own steps ("Generate English", "Generate French", some in parallel). Several
steps running at once look like a serial list in which only one is running.

#### Decisions

- **Sub-steps live inside the parent's step list** (owner, above), as a tree. The root is the card's task. A step can
  have child steps, and a step with children unfolds when tapped. This replaces the old rule "Helpers do not add steps
  of their own to the task" (`docs/plan/slices/10-task-steps.md:38-39`, `docs/clients.md:287-289`). A helper now
  reports its own steps as children of the step it works on.
- **Several steps can be running at once** (owner, above). The one-active rule (`steps.ts:33`, kept by Slice 29) goes
  away. A step that is running gets a ring that turns around its number, not just the highlight (owner, above). When
  the viewer's system asks for reduced motion, the ring is still drawn but does not turn.
- **Tapping a step unfolds it in place** (owner, above). It shows the full note, when the step started and finished,
  how long it took or has been running, and its children, which can be tapped again.
- Decided by the planning session of 2026-11-18:
  - A step gets a stable `id` (the reporter's, or one the server makes from the label path). It also gets
    `started_at` and `done_at`, which the server stamps when the state changes (UTC ISO, application layer, like every
    stored time).
  - Limits: depth 4, at most 200 steps in the whole tree. Label and note lengths stay as they are. A report over a
    limit is refused whole, as today.
  - `report_progress` gets `under_step: <step id>`. With it, `steps` replaces only that step's children, so a helper
    can write its own subtree without replacing the parent's list.
  - The header shows the running step's label when one step runs, and "N running" when several do. "Starting" shows
    only while no step is done and none is running. Progress counts leaves (steps with no children).
  - Order: siblings keep the order the reporter gives. ~~Each row shows its start time~~ (the mock supersedes this:
    the row shows no start time; the start time is in the open box, "Started 13:12 · ...").
    Steps that run at the same time are drawn as siblings, each with its own ring.
- A mock exists now (owner, 2026-11-18: "One does now, and the mock wins"): `ActiveV3.dc.html`,
  `ActiveV3Dark.dc.html` and `ActiveV3Phone.dc.html`. The earlier line of this slice, "No mock exists for the tree,
  the ring or the unfolded row ... If the owner later adds a mock to the canvas, the mock wins", is superseded (the
  mock supersedes this): every value now comes from the mock, in the Design subsection below.

#### Design (ActiveV3, ActiveV3Dark and ActiveV3Phone mocks, h2 line 49 of each, added 2026-11-18)

Three frames, all of the Active work page with three cards (a slice, a refine task, a fix task): `ActiveV3.dc.html`
(light, 1440x2300), `ActiveV3Dark.dc.html` (dark, 1440x1500) and `ActiveV3Phone.dc.html` (dark, 390x2900; the README
table lists the h1 at line 31 and the card h2 at line 49 of each). The mock agrees with the plan on unfolding in place,
several steps running at once, a turning ring and leaves counted. It differs in the header wording, the numbering, the
state text and the open box, and this slice now follows it. Colours are the names in each file's `CONFIG.theme` (light
and dark values are in the files): `card`, `border`, `text`, `muted`, `sub`, `track`, `sliceBg`, `sliceFg`, `doneFg`.
The outcome line, the card's top row and the page header lines are Slice 41's. The sample cards, steps and times
("Record audio, 15 languages", "French", "13:12") are made-up data. The canvas loads Inter and JetBrains Mono only to
draw the frames; the page keeps its own fonts.

- **B1 Steps list** (ActiveV3 lines 60 to 90). An `ol`, `aria-label` "Steps", gap 2px, top border 1px `border`,
  padding-top 10px, inside the card. Each row is an `li` with padding-left 26px per level (0, 26px, 52px, ...).
- **B1 Row** (lines 62 to 72). One full-width button, min-height 44px, radius 8px, padding 6px 8px, no border, grid
  columns `16px 30px minmax(0, 1fr) auto`, gap 8px, `aria-expanded` set. Background `sliceBg` while the step runs,
  transparent otherwise. Every row is tappable, with or without children.
- **B1 Unfold arrow**: a 14px chevron (path `M9 6l6 6-6 6`, stroke 2.4, round caps) in `text`, drawn only on a row
  that has children; a leaf keeps the 16px column with a transparent arrow. Open: rotated 90deg.
- **B1 Number**: a 28px box holding a 22px circle (10px, 700, border 1.5px). The number is the path: "1", "3", "3.2",
  "3.2.1" (siblings count from 1 within their parent). Done: fill `doneFg`, text `card`, border `doneFg`. Running:
  fill `card`, text `sliceFg`, border transparent. Waiting: fill `card`, text `muted`, border `border`.
- **B1 Ring** (line 67). On every running step, a parent included: an SVG 28x28, circle r 12.5 at centre 14, no fill,
  stroke `sliceFg` 2px, round caps, `stroke-dasharray` "20 59" (an arc, not a closed ring). It turns once every 1.4s,
  linear, endless (`ring-turn`, `transform-origin: 50% 50%`). Under `prefers-reduced-motion: reduce` the animation is
  off and the arc stays drawn. `sliceFg` is #1D4ED8 light and #9DBDFF dark.
- **B1 Label and second line** (lines 69 to 72). Label: weight 600 while running, 400 otherwise; `muted` when done,
  `text` otherwise. Second line: 12px, `muted`, one line with an ellipsis. For a leaf it is the note. For a parent it is
  "X of Y sub-steps done · N running · <note>"; "· N running" is left out when none runs, "· <note>" when there is no
  note. X and Y count the leaves of that parent's whole subtree.
- **B1 State text** (line 73), right-aligned, 12px, 600, tabular numbers, no wrap. Done: "Done · 8 min" in `doneFg`.
  Running: "Running · 1 h 02 min" in `sliceFg`. Waiting: "Next" for the first waiting step among its siblings and
  "Later" for the others, in `muted`.
- **B1 Open box** (lines 75 to 82). Under the row; margin `2px 0 6px 62px`, padding 10px 12px, radius 8px, border 1px
  `border`, no fill, gap 4px, 13px. Lines in order: the full note (when there is one); the times line (tabular
  numbers, `sub`); for a parent, "N sub-steps below; tap one to open it" in `muted`. Times line: "Started 13:12 ·
  finished 13:20 · took 8 min" for a done step, "Started 13:20 · running for 52 min" for a running one, "Not started
  yet" for a waiting one. Times are HH:MM and durations "N min" or "N h NN min", as drawn. The children of an open
  parent are drawn as rows below it, one level deeper, not inside the box.
- **B1 Open state**: one row's open state does not close another's. First view as the frames show it: light and phone
  open "Record audio, 15 languages", its helper-agent row "Record the audio, three languages at a time" and that row's
  "French" child (3, 3.1, 3.1.2); dark opens the first two steps of the second card and step 3 of the first card
  (canvas version `1795013012-daf3`, 2026-11-18).
- **B2 Header and progress** (lines 54 to 58). Header line 15px, 700, `sliceFg`; progress at the right, 13px, `sub`,
  tabular numbers, "{done} of {total} steps · {pct}%"; under both a bar 8px high, radius 4px, track `track`, fill
  `sliceFg`. Header text: "N running" when more than one leaf runs; the running leaf's label when one runs;
  "Waiting for the next step" when none runs and some are done; "Starting" when none is done. Progress counts leaves.
- **Phone** (`ActiveV3Phone.dc.html`): the same rows and box at 390px; page padding `16px 12px 40px`; the box keeps its
  62px left margin.

New strings, English and German (`web/src/strings.ts`): "{n} running", "Waiting for the next step", "Done · {dur}",
"Running · {dur}", "Next", "Later", "Not started yet", "Started {time} · finished {time} · took {dur}", "Started
{time} · running for {dur}", "{n} sub-steps below; tap one to open it", "{done} of {total} sub-steps done". "Starting"
and the "{done} of {total} steps · {pct}%" line already exist.

**Plan changed to match the mock (2026-11-18):**
- Step numbers are paths ("3.2.1"), indented 26px per level; the arrow only on rows with children (B1 Number, B1
  Unfold arrow).
- A parent's second line reads "X of Y sub-steps done · N running · <note>" (B1 Label and second line).
- The open box holds the note, the times line and, for a parent, "N sub-steps below" (B1 Open box). The plan's "its
  children, which can be tapped again" stays; the children are rows below the open parent.
- The ring is a 28px arc turning every 1.4s (B1 Ring); the plan only said "a ring".
- Header: the middle case "Waiting for the next step" is added to "N running", the one running label and
  "Starting" (B2). The plan's "Starting shows only while no step is done and none is running" stays true.
- The line "No mock exists for the tree, the ring or the unfolded row" is superseded (kept above).

#### Work

Part A, data and tools:
- [x] Add `id`, `children`, `started_at` and `done_at` to a step (`src/domain/stepTypes.ts`), plus the depth and
  200-step limits and the removal of the one-active rule (`src/domain/steps.ts`). Old flat lists still read as a tree
  of depth 1.
- [x] Have the server stamp `started_at` and `done_at` on state change, keeping them across reports by `id`
  (`src/domain/upsert.ts`). Steps change detection stays as documented (Slice 10).
- [x] Add `under_step` to `report_progress` (`src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/application/board.ts`).
  An unknown step id is refused with the list of known ids.
- [x] Rewrite the steps rules in `SERVER_INSTRUCTIONS` (`src/mcp/instructions.ts`) and mirror them in `SKILL.md`
  (held equal by `test/pluginRules.test.ts`). New rules: steps form a tree; a helper reports its steps with
  `under_step`; several steps may be active; send the whole list or only the subtree. Update
  `docs/clients.md:287-289`.

Part B, page:
- [x] Draw a tree of rows as B1 (`web/src/stepsView.tsx`, `web/src/active.css`): path numbers (1, 3.2, 3.2.1), 26px
  indent per level, the unfold arrow only on rows with children, every row tappable. Tapping a row opens the box under
  it (note; "Started ... · finished ... · took ..." or "Started ... · running for ..."; for a parent "N sub-steps
  below; tap one to open it"). One row's open state doesn't close another's.
- [x] Draw the 28px turning ring of B1 around the number of every running step (`web/src/active.css`), stopped under
  `prefers-reduced-motion` (the arc stays).
- [x] Parent second line, state text, header and progress as B1 and B2 (`web/src/stepsText.ts`,
  `web/src/ActiveCard.tsx`): "N running" or the one running label, "Waiting for the next step", "Starting" only
  before anything is done, leaves counted. English and German strings in `web/src/strings.ts`.
- [x] Check the page against `ActiveV3`, `ActiveV3Dark` and `ActiveV3Phone` (light, dark, 390px).

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New tests: tree limits, `under_step` replaces only the subtree,
  stamps kept across reports, several active steps, old flat lists still read.
- `npm run test:e2e` (`e2e/active.spec.ts`), with a fixture card shaped like the owner's two examples: a book with
  "Record audio, 15 languages" holding three running language children, and a 30-step wave. Tapping unfolds in place;
  three rings turn; the header says "3 running"; the reduced-motion emulation shows still rings; a parent's second
  line, state text and open box read as in the Design subsection; the numbers are paths.
- After the release, on the owner's phone: a real card with a sub-agent's steps unfolds under its step.

#### From review

Five findings files read in full: `reviews/pr-143-high.md` (10 findings), `reviews/pr-143-medium.md` (6),
`reviews/pr-143-check-medium.md` (10), `reviews/pr-143-check-2-medium.md` (10), `reviews/pr-143-check-3-medium.md` (5).
Every finding not listed below was applied. The third check pass converged: its 5 findings are all low
follow-ups left open (stale `|generation` key suffix in `web/src/ActivePage.tsx`; uncapped read-time `parseStoredSteps`
on legacy rows; read-time forcing of children done under a done parent; no batch-order test for the `changes()` event
insert; repeated reads per CAS retry).

- Skipped #3 (`reviews/pr-143-medium.md`): "a not-done step with `children` omitted keeps stored children unchanged; the new state is not applied to them" - the kept children are the helpers' own under_step reports; letting a parent's resend that omits children overwrite them would undo the fix for pr-143-high #2.
- Skipped #4 (`reviews/pr-143-medium.md`): "the collapse toggle for the step list was removed; MAX_STEPS rose 30 to 200 and the full tree always renders" - the ActiveV3 mocks draw the list always open and the mock wins over the plan; 200 rows render without a wait.
- Skipped #2 (`reviews/pr-143-check-medium.md`): "withinLimit shortens long ids with a 32-bit FNV hash; a collision is a hard refusal or silently merges started_at/done_at stamps by id" - the hash tail sits on an id already cut at 80 characters, so it collides only between two different over-long labels under one parent. Follow-up.
- Skipped #3 (`reviews/pr-143-check-medium.md`): "parseStoredSteps re-runs buildSteps (id generation, used set) for up to 200 steps on every row of every board read" - 200 steps per row is bounded and cheap next to the D1 read. Follow-up.
- Skipped #6 (`reviews/pr-143-check-medium.md`): "CAS compares exact steps JSON text: a re-serialised but equal tree causes needless retries; the guard sits on ON CONFLICT so a concurrent first insert of the same key is never CAS-guarded" - a first insert has no stored steps to lose. Follow-up.
- Skipped #7 (`reviews/pr-143-check-medium.md`): "replaceChildren refusal lists every known id" - refused only on a caller error, bounded by the 200-step limit. Follow-up.
- Skipped #8 (`reviews/pr-143-check-medium.md`): "Deepest unrolled level uses z.object (strips unknown keys), so a 6th level's children vanish silently and the depth refusal is inexact" - a sixth level is already far past the 4-level limit callers are told about. Follow-up.
- Skipped #9 (`reviews/pr-143-check-medium.md`): "Open-state Set is keyed by label-path-derived ids; a reworded label changes the id and collapses an open box mid-read; drawer and card hold separate state" - rewording a label is rare and the rules now tell reporters to send stable ids. Follow-up.
- Skipped #2 (`reviews/pr-143-check-2-medium.md`): "`retryable` on DomainError is never read" - the message text already says to send the same report again; exposing the flag on the wire is new API. Follow-up.
- Skipped #4 (`reviews/pr-143-check-2-medium.md`): "Reserve loop in resolveIds bumps '#2' to '#3' depending on stored ids, so same report yields different ids per card and a kept child can lose its stamp" - low, no data loss. Follow-up.
- Skipped #5 (`reviews/pr-143-check-2-medium.md`): "parseStoredSteps runs the full resolveIds/buildSteps pipeline on every read, uncached; legacy ids regenerated every read" - low, bounded by 200 steps, no data loss. Follow-up.
- Skipped #6 (`reviews/pr-143-check-2-medium.md`): "Parent started_at/done_at are stamped from the parent's own state, not its leaves" - low, a display detail, no data loss. Follow-up.
- Skipped #7 (`reviews/pr-143-check-2-medium.md`): "keptChildren re-stamps pending kept children when a parent" - a never-run child of a parent reported done is shown done, which is what the reporter said; its stamp is a display detail and no stored report is lost. Follow-up.
- Skipped #8 (`reviews/pr-143-check-2-medium.md`): "stepsField description hardcodes" - low, no data loss. Follow-up.
- Skipped #9 (`reviews/pr-143-check-2-medium.md`): "Tree flattened and id-indexed at least three times per report (stampFrom, normalizeSteps, checkTree, kept ids); share one Map" - low, bounded by 200 steps, no data loss. Follow-up.

#### For CLAUDE.md (lifted 2026-11-18)

- Every write of `items.steps` goes through `saveStepsReport` in `src/application/board.ts` (compare-and-swap); never add a
  second write path (Slice 39: docs/plan/slices/39-step-tree.md).
- Step ids are resolved only by `resolveIds` in `src/domain/steps.ts`; never generate or reuse ids elsewhere (Slice 39:
  docs/plan/slices/39-step-tree.md).
- The event insert is bound to its own write by `changes() > 0` in `src/infrastructure/d1Repository.ts`; keep the two
  statements adjacent in the batch (Slice 39: docs/plan/slices/39-step-tree.md).

#### Not yet verified

- On a phone and the deployed board, a real tree with helpers reporting `under_step` in parallel.
- The ring under reduced motion, on a real device.
