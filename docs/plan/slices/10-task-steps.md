### Slice 10 — Task steps and the active work page

Source: the owner at the desk, 2026-11-16 ("in another page, we'll have the active work, which is
the tasks that agents are working on ... if the agent is done with implementation, 1 of 7 is done
14% of the task is done and the progress bar should show that ... with an option to expand and see
the work steps, what is done and what is active and what is next").

*Planned.* Part A (server) can be built now. Part B (the page) waits for the owner's design mock.

**Touches:** `migrations/0004_steps.sql`, `src/domain/steps.ts`, `src/domain/item.ts`,
`src/domain/upsert.ts`, `src/application/board.ts`, `src/application/ports.ts`,
`src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`,
`src/api/boardDto.ts`, `src/config.ts`, `config/board.example.json`, `test/**`,
`docs/clients.md`, `README.md`, `web/**`, `e2e/**`, `docs/design/**`

#### Why

A tile says "in progress" and nothing more. The owner wants to see, for each piece of work an
agent holds, how far it is and what it is doing now.

#### Decisions (owner, 2026-11-16)

- **A task carries its own list of steps.** The board has no built-in list. The owner's example
  (implementation, review 1, fixing, review 2, two device tests, merging) was an example, not a
  default. Each kind of agent has its own usual list on the client side, and each task trims it
  to what it really needs: no phone test when no phone code changed.
- **Steps are equal for now.** Progress is steps done over steps in the list: 1 of 7 is 14%.
- **The list can change while the task runs.** The client sends the whole list each time; the
  newest list wins.
- **What a helper agent does counts under the step of the agent that started it.** Helpers do
  not add steps of their own to the task.
- **An active work page** lists every task an agent is working on now, across projects, each
  with its bar, the step it is on in words (for example "Reviewing"), and a way to open the full
  list: done, active, next.
- **Design:** the owner makes a mock for the active work page and the bars first; the page is
  built to match it (the mock wins over this file).

#### Decided at the desk (not the owner's choices)

- `report_progress` gets three optional fields: `steps` (an ordered list, each with a label and
  one of done, active or pending; at most 30), `agent` (the agent's kind, free text) and
  `model`. No new tool. An item without `steps` behaves as today.
- A step label is free text from the client, shown as sent; the board holds no step names and
  no copy for them.
- "Working on now" means: status in progress, a steps list or an agent set, and a heartbeat
  that is not stale (the rule from [Slice 7](07-stale-detection.md)). A stale task leaves the
  active page and shows as stale on the board, as today.
- A task that is marked done shows 100% whatever its list says; the list is kept for the
  history.
- The active page reads the same `/api/board` data, with the new fields added to each item; no
  second read route.
- Migration 0004 adds the columns to `items`. If [Slice 8](08-usage-reports.md) has not merged
  first, take the next free number from `parallel-check` instead.

#### Work

**A. Server (no design needed)**

- [ ] **A1.** Migration and domain: the steps list on an item, its validation (one active step
      at most, labels 1 to 80 characters), progress as done over total. Pure, with tests for
      1 of 7, an empty list, a list that shrinks, a done item.
- [ ] **A2.** `report_progress` accepts and stores `steps`, `agent`, `model`; `get_item` and
      `list_open` return them; `/api/board` carries them with the worked-out progress.
- [ ] **A3.** `docs/clients.md`: the fields, "send the whole list each time", how a client
      trims the list, helpers count under their parent's step. README line.

**B. Page (after the mock)**

- [ ] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it.
- [ ] **B2.** The active work view: one entry per working task with project, title, agent kind,
      model, bar, current step, and the list on expand. Empty state when nothing runs.
- [ ] **B3.** The same bar and current step on the task's tile and in its detail drawer.
- [ ] **B4.** Browser tests against a faked `/api/board`, phone and desktop sizes.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1.
- A report with seven steps, one done and one active, reads back as 14% with the active step's
  label; the next report with six steps (one dropped), two done, reads back as 33%.
- On the deployed board: three tasks reported by a real client run, two in one project and one
  in another, all show on the active page with the right step; one whose session is killed
  leaves the page when it turns stale.
- `npm run test:e2e` green for part B.
