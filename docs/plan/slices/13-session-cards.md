### Slice 13 — A session's card says what it is doing and what it needs

*Planned.* Part A (server) can be built now. Part B (the page) waits for the Claude Design mock
named in the [design brief](../notes/2026-11-17-design-brief.md).

**Touches:** `migrations/0006_needs_you.sql` (new), `src/domain/item.ts`, `src/domain/upsert.ts`,
`src/domain/stale.ts`, `src/domain/steps.ts`, `src/application/board.ts`, `src/application/ports.ts`,
`src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/api/boardDto.ts`,
`src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`, `web/**`, `e2e/**`,
`scripts/seed-data.ts`, `docs/plan/slices/13-session-cards.md`

**Migrations:** 0006

#### Why

The owner, 2026-11-17: a session card read only "main · <repo folder>" with a "session" tag. The
owner knew from the session itself that it was reading a crash log from a phone, for a slice, and
that its steps were: connect the phone, read the logs, analyse, conclude, then plan or fix. "These
all should be known." The same session showed as active after it had stopped. A second card for the
same session said "<project> session needs you: Claude is waiting for your input", and its history
flipped Open, Done, Open, Done ("Session stopped") through the night. The owner: "there is no
information on what the task is, what was done, what does the agent need from me, what is the
purpose of the card".

Read on 2026-11-17 from the code: the client sends the working item with only a title (branch and
folder) and an agent; the waiting item is a second item of type `waiting_for_me` under another key,
because `ask_human` refuses a key of another type (`src/application/board.ts`); the waiting text is
Claude Code's generic notification; the heartbeat expiry is 120 minutes by default with a floor of
60 (`src/domain/stale.ts`).

#### Decisions (owner, 2026-11-17, "agree to all")

- **The session writes its own card.** When it picks up a task it sends a one-line goal (the
  title), what the work is for (`why`, for example "for Slice 7 of example-app"), and its planned
  steps. It ticks the steps off as it goes. What it has done goes in `details_md`. The board needs
  no new field for these: `title`, `why`, `steps` and `details_md` exist. The client side (rule and
  hook reminder) is planned in the owner's config repo.
- **One card per session.** "Needs you" is a state of the same card, not a second card. It holds
  the agent's own question and what happens after the owner answers.
- **A card leaves "Working now" when the session stops working.** A notification never reopens a
  finished card. A session with no activity for 15 minutes turns stale and leaves "Working now".
- **Waiting items of the old shape** (type `waiting_for_me` under a session key) stay readable but
  are no longer created for sessions; steps only the owner can do (a console step, a device in hand)
  still use `waiting_for_me`.

#### Decided at the desk

- **"Needs you" is two fields on any item, not a type:** `needs_you` (the question, up to 2000
  characters) and `after_answer` (what the agent will do next, up to 500). An item with `needs_you`
  set and not done shows under "Needs you" whatever its type. Setting it is part of
  `report_progress`; clearing it is a report with `needs_you: null`, or any report that moves the
  item to `in_progress` after the owner answered, or `done`. `ask_human` keeps working as today for
  `waiting_for_me` items, and on a key of another type it sets `needs_you` on that item instead of
  refusing.
- **The 15-minute expiry applies to session cards only** (items whose `agent` is `session`). Slices
  and waves keep the configured expiry. The rule exists twice (`isExpired` and the `EXPIRED_ROWS`
  SQL); both change and `test/stale.test.ts` keeps them equal. The 60-minute floor stays for the
  configured expiry; the session expiry is its own constant.
- **A stale session card with `needs_you` set stays under "Needs you"**: a question waits for the
  owner, not for a heartbeat. It leaves when answered, closed, or after the configured expiry.
- **History reads in plain words.** Each event row keeps its status, and the drawer shows the state
  change as the owner sees it ("started", "needs you: <first line>", "answered", "finished turn",
  "stale"), not "Open" and "Done". The wording lives in the page's string table.

#### Work

**A. Server**

- [ ] Migration 0006: `needs_you TEXT NULL`, `after_answer TEXT NULL`, `needs_you_at TEXT NULL` on
  items. Upsert rules in `src/domain/upsert.ts`; schema fields with limits in `src/mcp/schemas.ts`;
  `docs/clients.md` documents them with an example on a made-up project.
- [ ] `ask_human` on a key of another type sets `needs_you` (from `why`) on that item and returns
  ok. Tests: on a `waiting_for_me` key (as today), on an `unplanned` key, on a missing key (creates a
  `waiting_for_me` item as today).
- [ ] Session expiry: a constant `SESSION_STALE_AFTER_MINUTES = 15` in `src/domain/stale.ts`, used
  by `isExpired`, `isHeartbeatExpired` and the `EXPIRED_ROWS` SQL for `agent = 'session'` items; the
  equality test covers both expiries.
- [ ] `/api/board` returns `needs_you`, `after_answer`, `needs_you_at`; the board DTO groups an item
  with `needs_you` under the project's "needs you" list.
- [ ] Seed data: one session card working with three steps, one with a question, one stale.

**B. Page (after the design mock is imported into `docs/design/`)**

- [ ] The "Needs you" card and the session card built exactly as the mock shows: goal, purpose,
  steps with the current one marked, what was done, the question and what happens after.
- [ ] Drawer history in plain words from the string table.
- [ ] E2E: a session card with steps, one with a question, a stale one leaves "Working now".

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- On the deployed board, with the config repo's client from the same date: a real interactive
  session shows its goal and steps within five minutes, a question shows under "Needs you" with its
  text, and after the session stops its card leaves "Working now" at once.
