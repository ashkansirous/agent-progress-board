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
`web/src/ActiveCard.tsx`, `web/src/SessionCards.tsx`, `web/src/strings.ts`, `test/mcpInstructions.test.ts`,
`test/pluginRules.test.ts`, `test/upsert.test.ts`, `test/board.test.ts`, `e2e/active.spec.ts`,
`docs/plan/slices/41-tasks-with-outcome.md`

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

#### Work

- [ ] Add `outcome` to items: migration 0009, schema, upsert, the board read (`src/api/board.ts`), and the card on
  the page (`web/src/ActiveCard.tsx`, `web/src/SessionCards.tsx`, strings EN and DE).
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
- `npm run test:e2e`: a card shows its outcome line.
- After the release and the config repo's matching slice: during one wave night, the board shows the slice cards
  with their trees and no wave card. A plain question in a chat makes no card.
