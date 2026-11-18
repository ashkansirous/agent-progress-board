### Slice 41 — Only a task with an outcome gets a card

*Planned 2026-11-18. The owner's words (2026-11-18): "orchestrators (run-all-wave and run-wave) are not tasks/slices,
and thus should not appear in the board. a normal chat with claude code, is not a task/slice so it would not appear
there, but as soon as it picks up an actual action, like implementing a slice, or even /RefineScope or alike where
some actions are being taken and an outcome is supposed to be delivered, then that taks with outcome should be on the
board. for example, for a slice, the task is implementing slice, the outcome is code being deliverd. for the
/RefineScope the task is refining an idea/sets of ideas the outcome is a plan (a few slices in the plan)."*

Runs after Slices 39 and 40. The owner's config repo has a matching slice for its wave tooling.

**Touches:** `src/mcp/instructions.ts`, `src/mcp/schemas.ts`, `src/domain/upsert.ts`, `src/api/board.ts`,
`src/infrastructure/d1Repository.ts`, `migrations/0009_outcome.sql` (new), `plugin/skills/agent-board/SKILL.md`,
`plugin/scripts/hooks/goal-reminder.mjs`, `plugin/scripts/hooks/session-done.mjs`,
`plugin/scripts/hooks/hooks.test.mjs`, `plugin/scripts/report-progress.mjs`, `docs/clients.md`,
`web/src/ActiveCard.tsx`, `web/src/ActivePage.tsx`, `web/src/SessionCards.tsx`, `web/src/SessionDrawer.tsx`,
`web/src/cards.ts`, `web/src/model.ts`, `web/src/active.css`, `web/src/board.css`, `web/src/strings.ts`,
`scripts/seed-data.ts`, `test/mcpInstructions.test.ts`, `test/pluginRules.test.ts`, `test/upsert.test.ts`,
`test/board.test.ts`, `test/web.test.ts`, `e2e/active.spec.ts`, `e2e/session.spec.ts`, `e2e/board.spec.ts`,
`docs/plan/slices/41-tasks-with-outcome.md`, `docs/plan/slices/13-session-cards.md`

**Migrations:** 0009 (0008 is planned in Slice 34; if 34 hasn't merged first, take the next free number then)

#### Why

Today every session opens a card at its start, before its first answer (`SERVER_INSTRUCTIONS`). The plugin's hook
reminds the session after every tool call while it has no card. So plain chats get cards, and so do orchestrators: a
wave session's card ("Night ... wave 4: build up to 4 of ...") mixes its slices' builds into one list. The owner wants
a card only for a task that has an outcome.

#### Decisions

- **A card is a task with an outcome** (owner, above). The root of its tree is the session doing the task (Slice 39).
  Examples from the owner: implementing a slice (outcome: the code delivered), and refining ideas with RefineScope
  (outcome: a plan, a few slices).
- **No card for a plain chat** (owner, above). A session opens its card when it takes on such a task, not at its
  start. A question answered in the chat is not a task.
- **No card for an orchestrator** (owner, above). The wave sessions in the owner's config repo are orchestrators. The
  slices they build each have their own card, and the wave's agents report under those slice cards. This repo gives
  orchestrators a way to say so; the wave tooling's own change is the config repo's slice.
- Decided by the planning session of 2026-11-18:
  - An item gets an `outcome` field (text, at most 200 characters, for example "Code merged to main" or "A plan with
    slices"). The card shows it under the title.
  - Work on a planned slice reports on the slice's own card (`<project>/slice-<N>`). Any other task gets a task card
    (type `unplanned`, key `<project>/task-<id>`).
  - An orchestrator runs `report-progress --orchestrator` once. That marks the session in `CLAUDE_PLUGIN_DATA`, and
    from then on the hooks open no card for it and send no reminder.
  - The hook reminder after a tool call becomes: "If this prompt started a task with an outcome, report it on the
    board". It is sent at most once per prompt, never after every tool call.
  - Questions asked while a session has no card still reach "Needs you" through the waiting card of Slice 27, so no
    question is lost.
- **Slice 13's goal-less state is replaced by this slice's rule** (owner, 2026-11-18, about the mock that no longer
  draws the "no goal reported yet" card: "that is my decision, not a loss of scope"). Slice 13 drew a working card with
  a dashed border and the line "Started 2 min ago, no goal reported yet" for a session with no goal, and the
  fallback-title test `hasNoGoal` (`web/src/cards.ts:42`) found it. Under this slice a session with no task and
  outcome has no card at all, so there is no goal-less card to draw. That card, its string (English and German), its
  `session-card-nogoal` class and `hasNoGoal` are removed. An item that still arrives with no goal and no outcome is not
  drawn as a working card; under Slice 13, a session with no activity for 15 minutes turns stale and shows greyed under
  Done, and nothing closes it automatically. An item with a goal but no outcome (older reports) is drawn as before,
  without the outcome line. (Both accepted by the owner, 2026-11-18, with the words "turns stale" not "closes".) Slice 13 gets a one-line dated note pointing here.
- **The mock no longer has a wave card.** The sample's "Build Slices 9 and 10 overnight" card is replaced by a slice
  card ("Implement Slice 9: export to PDF", "Slice 9 of example-app, built in tonight's wave"). This matches the
  orchestrator rule above; nothing in the page changes for it.

#### Design (ActiveV3 and BoardV2 mocks, added 2026-11-18)

Frames: `ActiveV3.dc.html`, `ActiveV3Dark.dc.html`, `ActiveV3Phone.dc.html` (h1 line 31, card h2 line 49; the cards'
steps are Slice 39's) and, for the board, `BoardV2.dc.html` (light; h3 "Working now" line 89, drawer h2 line 183),
`BoardV2Dark.dc.html` (dark, drawer open), `PhoneV2.dc.html`, `PhoneV2Light.dc.html` and `PhoneV2Drawer.dc.html`
(the same markup at 390px). The mock agrees with the plan that a card shows an outcome under its title. It differs
from the plan in the page header (two lines and a link, below) and in what a working card is. The sample projects,
titles and outcomes ("Code merged to main", "A plan with slices", "Build passes on main") are made-up data. All are
real frames of the page, not illustrations. Colour names are the `CONFIG.theme` keys of each file.

- **Outcome line on an Active work card** (ActiveV3 line 50; the title is line 49, the "why" line 51). Between the title
  and the why line, inside the same column (gap 4px). An inline row, gap 6px, 14px, weight 600, colour `doneFg`
  (#0B6B4B light, #7FD8B4 dark), starting with a 15px target icon (three concentric circles, radii 9, 5 and 1 at
  centre 12, stroke 2, round caps, drawn inline, not an icon font) in the same colour, then "Outcome: {outcome}". Title
  18px, 700; why line 13px, `sub`.
- **Outcome line on a board working card** (BoardV2 line 96, inside the card of lines 91 to 104). After the goal
  (16px, 700) and before the purpose (13px, `sub`): the same row at 13px weight 600 `doneFg` with a 14px icon, "Outcome:
  {outcome}". The card holds only goal, outcome, purpose and the step chips, plus the top row (session label at the
  left, "last activity N min ago" at the right). The sample session labels are "task · laptop" and "slice card · cloud
  VM" (made-up data in the mock; the label names what the card is, then where it runs).
- **Drawer** (BoardV2Dark `DRAWERS.w1`, h2 line 183; the same in `PhoneV2Drawer`): the purpose line starts "Outcome: the
  cause written into Slice 12 · for Slice 12: app crashes on start" ("Outcome: {outcome, first letter lower case} · {why,
  first letter lower case}"); the meta line "task · laptop · last activity 2 min ago". The other drawers are unchanged.
- **Working count**: the "2 working" pill in the board's top line (BoardV2 line 34) counts the two outcome cards; it
  was "3 working" with the goal-less card.
- **Active work header** (ActiveV3 lines 29 to 36). The h1 "Active work" (26px, 700). Under it two lines, both 13px,
  `muted`: "Tasks with an outcome that an agent is working on now · updated 14:12" (the time is real) and "Plain chats and
  wave runners get no card here; each slice a wave builds has its own." The first replaces `activeSubtitle` ("Tasks an
  agent is working on now, across projects · updated {time} · a task that stops reporting turns stale and leaves this
  page") and, on the phone, `activeRunning` and `activeRunningOne` ("{n} tasks running ..."): the phone frame shows the
  same two lines (ActiveV3Phone lines 32 and 33).
- **Waiting-questions link** (ActiveV3 line 36), under the header: an inline link, min-height 44px, padding 0 14px,
  radius 10px, background `needBg`, border 1px `needBd`, text `needFg` 600, "2 questions are waiting on the board" and a
  14px right arrow (path `M5 12h14M13 6l6 6-6 6`, stroke 2) in `needFg`. It goes to the board's "Needs you" section.
  The number is the count of open questions on the board (`needs_you`, all projects), filled from data.
  Not drawn: the zero and one cases. The mock-faithful reading is that the link exists to show waiting questions, so
  it is absent at zero; one question uses the same pattern, "1 question is waiting on the board". These two are the
  only values here that the mock does not show (accepted by the owner, 2026-11-18).

New strings (English and German): "Outcome: {outcome}", "Tasks with an outcome that an agent is working on now ·
updated {time}", "Plain chats and wave runners get no card here; each slice a wave builds has its own.", "{n} questions
are waiting on the board", "1 question is waiting on the board". Removed: the "no goal reported yet" string,
`activeSubtitle`, `activeRunning`, `activeRunningOne`.

**Plan changed to match the mock (2026-11-18):**
- The outcome shows under the title on Active work cards and board working cards, and in the drawer's purpose line
  (mock: the three lines above). The plan had only "The card shows it under the title".
- The goal-less working card and its string are removed, and the wave card is gone from the sample (mock: BoardV2 lines
  103 to 105 gone; `w3` and the wave `w2` replaced). Owner's decision above, not a loss of scope.
- The Active work subtitle is replaced by two lines, and the waiting-questions link is added (mock: ActiveV3 lines 32,
  33, 36; the owner asked for both).
- Touches: added `ActivePage.tsx`, `SessionDrawer.tsx`, `cards.ts`, `model.ts`, `active.css`, `board.css`,
  `scripts/seed-data.ts`, `test/web.test.ts`, `e2e/session.spec.ts`, `e2e/board.spec.ts` and Slice 13's file.

#### Work

- [ ] Add `outcome` to items: migration 0009, schema, upsert, the board read (`src/api/board.ts`), and the outcome
  line of the Design subsection on the Active work card, the board working card and the drawer purpose
  (`web/src/ActiveCard.tsx`, `web/src/SessionCards.tsx`, `web/src/SessionDrawer.tsx`, strings EN and DE).
- [ ] Active work header (`web/src/ActivePage.tsx`, `web/src/strings.ts`): the two lines and the waiting-questions link
  of the Design subsection, replacing `activeSubtitle`, `activeRunning` and `activeRunningOne`.
- [ ] Remove the goal-less card (`hasNoGoal` in `web/src/cards.ts`, the dashed card in `SessionCards.tsx`, its CSS and
  strings, the seed's no-goal item) per the owner's decision above. Add a one-line dated note to Slice 13.
- [ ] Rewrite the opening rule in `SERVER_INSTRUCTIONS` (`src/mcp/instructions.ts`): a card opens when a task with an
  outcome starts, with `outcome` set; plain chats and orchestrators open none; a slice's work reports on the slice
  card. Mirror it in `SKILL.md`, and update `docs/clients.md`.
- [ ] Add the `--orchestrator` mark (`plugin/scripts/report-progress.mjs`), read by `goal-reminder.mjs` and
  `session-done.mjs`.
- [ ] Change the reminder text and send it once per prompt (`goal-reminder.mjs`).

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New tests: an orchestrator session gets no card and no reminder;
  the reminder fires once per prompt; `outcome` is stored and returned; the instructions text and `SKILL.md` stay
  equal.
- `npm run test:e2e`: a card shows its outcome line on Active work, on the board and in the drawer; the Active work
  header shows both lines and the link with the real count; there is no "no goal reported yet" card. Compare with
  `ActiveV3` and `BoardV2` in light, dark and at 390px.
- After the release and the config repo's matching slice: during one wave night, the board shows the slice cards
  with their trees and no wave card. A plain question in a chat makes no card.
