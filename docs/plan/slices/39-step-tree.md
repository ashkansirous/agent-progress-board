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
`docs/plan/slices/39-step-tree.md`

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
  - Order: siblings keep the order the reporter gives. Each row shows its start time, so the real order can be seen.
    Steps that run at the same time are drawn as siblings, each with its own ring.
- No mock exists for the tree, the ring or the unfolded row. Every value (colours, sizes, spacing) comes from the
  existing tokens and the step-number circle in `docs/design/Active.dc.html`. The ring uses the colour the design
  gives the running step. If the owner later adds a mock to the canvas, the mock wins.

#### Work

Part A, data and tools:
- [ ] Add `id`, `children`, `started_at` and `done_at` to a step (`src/domain/stepTypes.ts`), plus the depth and
  200-step limits and the removal of the one-active rule (`src/domain/steps.ts`). Old flat lists still read as a tree
  of depth 1.
- [ ] Have the server stamp `started_at` and `done_at` on state change, keeping them across reports by `id`
  (`src/domain/upsert.ts`). Steps change detection stays as documented (Slice 10).
- [ ] Add `under_step` to `report_progress` (`src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/application/board.ts`).
  An unknown step id is refused with the list of known ids.
- [ ] Rewrite the steps rules in `SERVER_INSTRUCTIONS` (`src/mcp/instructions.ts`) and mirror them in `SKILL.md`
  (held equal by `test/pluginRules.test.ts`). New rules: steps form a tree; a helper reports its steps with
  `under_step`; several steps may be active; send the whole list or only the subtree. Update
  `docs/clients.md:287-289`.

Part B, page:
- [ ] Draw a tree of rows (`web/src/stepsView.tsx`). A row with children has an unfold arrow, and tapping any row
  unfolds it in place: full note, start, finish, how long, and the children. One row's open state doesn't close
  another's.
- [ ] Draw a turning ring around the number of every running step (`web/src/active.css`), still under
  `prefers-reduced-motion`.
- [ ] Header and progress (`web/src/stepsText.ts`, `web/src/ActiveCard.tsx`): "N running", "Starting" only before
  anything ran, leaves counted. English and German strings in `web/src/strings.ts`.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New tests: tree limits, `under_step` replaces only the subtree,
  stamps kept across reports, several active steps, old flat lists still read.
- `npm run test:e2e` (`e2e/active.spec.ts`), with a fixture card shaped like the owner's two examples: a book with
  "Record audio, 15 languages" holding three running language children, and a 30-step wave. Tapping unfolds in place;
  three rings turn; the header says "3 running"; the reduced-motion emulation shows still rings.
- After the release, on the owner's phone: a real card with a sub-agent's steps unfolds under its step.
