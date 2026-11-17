### Slice 26 — Every "Needs you" card says what is needed, for which work, and why; no card when nothing is asked

*Planned (owner, 2026-11-17, on a screenshot of four "Needs you" cards: "the only active session I havae with board is
you. why do I have so many things from you? ... 'claude is waiting your input' what input?! ... what the fuck is the
question and the options? ... which slice?! which task?! which fucking topic!!? ... where the fuck is the
description?! what the fuck do you need from me?").* Read live at 20:2x from `list_open` (type `waiting_for_me`):

- `<project>/session-<id>` "session needs you: Claude is waiting for your input" (source `hook`): the Notification
  hook's idle prompt opened it again about two minutes after every reply of a supervising session that was only
  waiting on a 10-minute timer and had asked nothing; it opened and closed 20 times between 17:55Z and 19:15Z. It
  carries no question, no options, no goal and no slice.
- Doc-sync cards from `**You:**` lines and from a `parked: ... waits for the user` row: the title is the bare line or
  "Waiting on you: <slice title>", `why` is empty or the park reason, no link to the slice, no description of what
  the step is for.

**Touches:** `plugin/scripts/hooks/**`, `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`, `plugin/scripts/report-progress.mjs`, `plugin/skills/agent-board/SKILL.md`, `src/mcp/instructions.ts`, `src/domain/**`, `web/src/**`, `test/**`, `e2e/**`, `docs/clients.md`, `docs/plan/slices/26-needs-you-cards.md`

**Migrations:** none

#### Work

- [ ] **No card when nothing is asked.** The Notification hook opens a waiting card only for a permission prompt or an
  elicitation, or for an idle prompt when the session's last assistant message (read from the transcript tail) ends
  with a question to the person. An idle prompt after a status line opens nothing. Verify: tests with a last message
  that is a status line (no card), one ending in a question (card), and a permission prompt (card).
- [ ] **The card carries the question.** A hook card's `needs_you` is the question itself (the last question sentence
  of the last assistant message, at most 300 characters), `after_answer` what happens once answered when the message
  says it, the title is the session's reported goal (or the project and branch when none), and a permission prompt
  names the tool and the command it asks for. Verify: tests for each.
- [ ] **Doc-sync cards say what and why.** A `**You:**` line's card has: title = the step (the line, without the
  `**You:**` prefix); `why` = the slice's title and what the step unblocks (the line's own "so that ..." when present,
  else "Not yet verified for Slice N: <slice title>"); a link to the slice file on the repo host. A parked row's card
  has: title = what the person must decide or do (the slice file's "Open for the owner" lines when present), `why` =
  the slice title, and the link. Verify: sync-docs tests for both kinds.
- [ ] **The page shows it.** A "Needs you" card shows the question (`needs_you`) and `why` in full (no one-line
  cut-off) and the link; a card with no question and no why shows "No question recorded" instead of repeating the
  title. Verify: e2e on a seeded card of each kind.
- [ ] **The rules say it.** `src/mcp/instructions.ts` (and the skill, held equal by its test): a question for the person
  goes in `needs_you` with the options and what each does, the work it belongs to (slice, task) in the title, and a
  direct link to where the person acts; never a card that only says "waiting". Verify: the instructions test reads
  these lines.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` green.
