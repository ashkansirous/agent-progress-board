### Slice 13 — A session's card says what it is doing and what it needs

*Built 2026-11-17, parts A and B; merged as PR #75 (538d555), deployed-board checks open (see Not yet
verified).* The plan PR #73 merged without a review round (owner).

**Touches:** `migrations/0006_needs_you.sql` (new), `src/domain/item.ts`, `src/domain/upsert.ts`,
`src/domain/stale.ts`, `src/domain/steps.ts`, `src/application/board.ts`, `src/application/ports.ts`,
`src/infrastructure/d1Repository.ts`, `src/api/board.ts`, `src/domain/parts.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/api/boardDto.ts`,
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
- **The question card says "answer in that session"; the board stays read-only** (owner, 2026-11-17,
  step 2 of the request for Slices 13 to 15). The page has no answer box and no button that writes.

#### Decided at the desk

- **What makes an item a session (claim check, 2026-11-17):** `agent` is free text in
  `src/mcp/schemas.ts` and no server code uses the value `session`; it is the clients' convention.
  The 15-minute rule keys on one exported constant `SESSION_AGENT = "session"` in
  `src/domain/stale.ts`, and the expiry row (`ExpiryRow` and the `EXPIRED_ROWS` SQL) gains `agent`.
  The DTO is built in `src/api/board.ts` (with `src/api/boardDto.ts` for the shape), and
  `src/domain/parts.ts` also calls `isWorkingNow`; both are in Touches.

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
  (Not in the mock: the mock's stale card has no question.)
- **History reads in plain words.** Each event row keeps its status, and the drawer shows the state
  change as the owner sees it ("started", "needs you: <first line>", "answered", "finished turn",
  "stale"), not "Open" and "Done". The wording lives in the page's string table. (The mock fixes the
  exact words, with a capital first letter: see *Design*, B3. The mock supersedes the lower-case
  wording.)
- **A stale session card without a question sits in the project's "Done" list, dashed and muted**
  (from the mock, `BoardV2.dc.html` line 268). [Slice 14](14-checks-in-slice.md) returns it in the
  `done` group.
- **The card's session label is "<parent> · <environment label>"** (from the mock: "session 9c1e ·
  laptop", "wave 3 · cloud VM"). The client sends the session or wave name in `parent`; the page
  writes the environment through `usage.environmentLabels` ([Slice 8](08-usage-reports.md)) and
  shows the raw value when no label is set.

#### Design (BoardV2 mock, sections BoardV2, BoardV2Dark, PhoneV2, PhoneV2Light, PhoneV2Drawer, added 2026-11-17)

Source: `docs/design/` ([README](../../design/README.md) sections table). Five frames matter here:
`BoardV2.dc.html` (desktop light), `BoardV2Dark.dc.html` (desktop dark, drawer open on the working
card `w1`), `PhoneV2.dc.html` (phone dark), `PhoneV2Light.dc.html` (phone light, Done opened) and
`PhoneV2Drawer.dc.html` (phone card detail, full screen, on the question `n1`). They are one
component with a theme and a `phone` switch, so they agree with each other. The mock agrees with the
plan on what a card holds; where it adds a choice the plan did not state it is marked "from the
mock". Colour names are the `CONFIG.theme` keys at line 246 of each file; the light and dark values
are listed in [Slice 15](15-project-blocks.md) *Design*. The nav bar, the project frame and the fold
are Slice 15; the Planned and Problems cards are Slice 14. Line numbers below are lines of
`BoardV2.dc.html` unless a file is named.

- **B1 Question card, desktop** (lines 69 to 81; data `PROJECTS.ex.needs`, line 250). Inside the
  project block, under the small heading "Needs you · {count}" (12px, 700, upper case, 0.06em,
  `needFg`). One button-card per question: background `needBg`, border 1.5px `needBd`, radius 14px,
  padding 16px 20px, gap 8px. Row 1, 12px, `needFg`: the word "Question" (700, upper case, 0.05em) and
  at the right "waiting 6 min" (600). Then the question in full, 19px, 600, line-height 1.35. Then
  what happens after, 14px, `sub`: "Then I read the log and write the cause into Slice 12." Then 12px,
  `muted`: "Asked by session 4f2a · laptop · answer in that session". Tapping the card opens the drawer.
  From the mock: the "Question" label, "waiting N min", "answer in that session".
- **B1 Question card, phone** (`PhoneV2.dc.html` lines 39 to 51 and 83 to 85). The question cards of
  every project come first, above the projects, under "Needs you · {total}" (h2, 15px, 700,
  `needFg`). Card: `needBg`, border 1.5px `needBd`, radius 14px, padding 14px 16px. Row 1, 12px,
  `needFg`: the project name (700, upper case) and "waiting N min" at the right. Question 17px, 600.
  After line 13px, `sub`. Last line 12px, `muted`: "Asked by session 4f2a · laptop" (the phone
  card does not say "answer in that session"; the drawer's "After you answer" box and the desktop
  card do). Inside its project block the phone shows only "Its question is at the top of the page."
  (13px, 600, `needFg`). From the mock.
- **B1 Working card** (lines 87 to 110; data `ex.working`, lines 252 to 254). Under "Working now ·
  {count}" (12px, 700, upper case, 0.06em, `muted`). A grid `repeat(auto-fill, minmax(320px, 1fr))`,
  gap 12px. Card: background `card`, border 1px `border`, radius 12px, padding 14px 16px, shadow
  `0 1px 2px rgba(0,0,0,0.04)`, gap 8px. Row 1, 12px, `muted`: the session label ("session 9c1e ·
  laptop") and at the right "last activity 2 min ago". Goal, 16px, 700, line-height 1.3 ("Read the
  crash log on the iPhone 8"). Purpose, 13px, `sub` ("For Slice 12: app crashes on start"). Then the
  steps as chips (an `ol`, `aria-label` "Steps", wrapped, gap 6px). From the mock: the card is white
  (`card`), not tinted, and the current step is a filled chip.
- **B1 Step chip** (`stepChips`, lines 311 to 316). Pill, 12px, padding 3px 9px, border 1px. Done:
  mark "✓", transparent, text `muted`, border `border`, weight 400. Now: mark "●", background
  `nowBg`, text `nowFg`, border `nowBg`, weight 700. Next and later: no mark, transparent, text
  `sub`, border `border`, weight 400. The mark and the weight say the state, so colour is not the
  only signal.
- **B1 Working card with no goal** (lines 103 to 105; data `w3`): the card border is dashed; one
  line, 14px, italic, `muted`: "Started 2 min ago, no goal reported yet" (the number is the real age,
  filled from data). From the mock.
- **B2 Drawer** (lines 175 to 242; `BoardV2Dark.dc.html` opens with `sel: "w1"`;
  `PhoneV2Drawer.dc.html` with `sel: "n1"`). Desktop: a panel 480px wide on the right, background
  `card`, padding 24px, shadow `shadow`, over a `scrim` that closes it when tapped. Phone: the same
  content full screen (`position: absolute; inset: 0`). Top row: kicker pill (11px, 700, upper case,
  radius 999px, padding 3px 10px; "Needs you" on `needBg`/`needFg`, "Working now" on
  `sliceBg`/`sliceFg`, "Stale" on `chip`/`muted`), the project name (12px, `muted`), and a close
  button 44 by 44px, radius 10px, border `border`, an X icon 16px, `aria-label` "Close". Then the
  title (h2, 21px, 700), the purpose (14px, `sub`) and the meta line (12px, `muted`: "session 9c1e ·
  laptop · last activity 2 min ago"; "session 4f2a · laptop · waiting 6 min"). For a question, under
  that a box: background `needBg`, border 1px `needBd`, radius 10px, padding 12px 14px, 14px, the bold
  label "After you answer:" (`needFg`) and the text ("I read the log and write the cause into Slice
  12.").
- **B2 Drawer sections** (headings 12px, 700, upper case, 0.06em, `muted`). "Done so far": a bullet
  list from `details_md`, one bullet per line ("Connected the iPhone 8 over USB"). "Steps": one row
  per step, grid `26px 1fr auto`, padding 7px 10px, radius 8px; a 22px round number marker, the
  label, and the state word at the right (12px, 600): "Done" (`doneFg`; marker filled `doneFg` with
  `card` text), "Now" (`sliceFg`; marker `card` with a `sliceFg` border; row background `sliceBg`;
  label 600), "Next" for the first later step and "Later" for the rest (`muted`, marker `card` with a
  `border` border). "Links": the item's links, weight 500. "History": rows in a grid `48px 1fr`, the
  time in mono 12px `muted`, then the words.
- **B3 History words** (`DRAWERS`, lines 283 to 308): "Started", "Needs you: which iPhone should I
  read the crash log from…" (the first words of the question, then an ellipsis), "Answered",
  "Finished turn", "Last activity", "Reading the logs" (a progress note the agent sent), "Stale: no
  activity for 15 min".
- **B4 Stale card** (data `st1`, line 268): not under "Working now" but a row in the project's Done
  list ([Slice 14](14-checks-in-slice.md) and [Slice 15](15-project-blocks.md) draw the list):
  background `chip`, dashed 1px `border`, text `muted`, title "session 7b3d · Update the store
  screenshots", at the right "Stale: no activity for 15 min · 08:55". It opens the drawer with the
  kicker "Stale" and the steps it had.
- **Simplified illustrations:** none is a labelling bubble. Every time (13:48, 09:31, "2 min ago")
  and every name (example-app, session 9c1e, the iPhone 8) is made-up sample data. The mock loads
  Inter and JetBrains Mono from Google Fonts only to render the canvas; the page keeps its own fonts
  and makes no third-party request.
- **Not in the mock** (stays in the slice as written): a stale card that still has a question (stays
  under "Needs you"); old-shape `waiting_for_me` items; a card whose goal is reported but has no
  steps (shows goal and purpose only).
- **New strings (EN and DE):** "Question", "waiting {n} min", "Asked by {session}", "answer in that
  session", "Its question is at the top of the page.", "Working now", "last activity {n} min ago",
  "Started {n} min ago, no goal reported yet", "Steps", "After you answer:", "Done so far", "Links",
  "History", "Done", "Now", "Next", "Later", "Needs you", "Stale", "Close", "Close details", "Card
  details", the history words in B3, "Stale: no activity for {n} min".

**Plan changed to match the mock (2026-11-17):** status line (part B is designed and is built after
the owner's review); Decisions gain the read-only question card; the history wording is fixed by the
mock (the lower-case wording is superseded); a stale card without a question sits in Done, dashed
(from the mock); the session label rule; part A gains the card fields and the mock's seed data; part
B work items are rewritten.

#### Work

**A. Server**

- [x] Migration 0006: `needs_you TEXT NULL`, `after_answer TEXT NULL`, `needs_you_at TEXT NULL` on
  items. Upsert rules in `src/domain/upsert.ts`; schema fields with limits in `src/mcp/schemas.ts`;
  `docs/clients.md` documents them with an example on a made-up project.
- [x] `ask_human` on a key of another type sets `needs_you` (from `why`) on that item and returns
  ok. Tests: on a `waiting_for_me` key (as today), on an `unplanned` key, on a missing key (creates a
  `waiting_for_me` item as today).
- [x] Session expiry: a constant `SESSION_STALE_AFTER_MINUTES = 15` in `src/domain/stale.ts`, used
  by `isExpired`, `isHeartbeatExpired` and the `EXPIRED_ROWS` SQL for `agent = 'session'` items; the
  equality test covers both expiries.
- [x] `/api/board` returns `needs_you`, `after_answer`, `needs_you_at`; the board DTO groups an item
  with `needs_you` under the project's "needs you" list.
- [x] The board DTO returns, for every card, `parent`, `environment`, `agent`, `heartbeat_at`,
  `steps` and `details_md` as data. The card label, "last activity N min ago" and "waiting N min" are
  built on the page from these and `needs_you_at`; the Worker returns no text. `docs/clients.md` says
  a session sends its own name ("session 9c1e") in `parent` (from the mock).
- [x] Seed data: the mock's made-up projects (`PROJECTS`, `BoardV2.dc.html` lines 248 to 282). Session
  cards: `example-app` with two working (one with a goal and five steps, one a wave on a cloud VM with
  five steps), one working with no goal, one with a question, one stale without a question; `tools`
  with only a question; `notes-site` with none.

**B. Page (design in `docs/design/`, see *Design* above)**

- [x] The question card as B1 (desktop and phone variants), "answer in that session", no control
  that writes.
- [x] The working card as B1: white card, goal, purpose, step chips with the current step filled,
  "last activity N min ago", and the no-goal card.
- [x] The drawer as B2 for a question, a working card and a stale card; desktop panel and phone full
  screen; the scrim closes it; the Close button is 44px.
- [x] Drawer history in plain words from the string table (B3).
- [x] Both themes from the theme keys, English and German strings.
- [x] E2E: a session card with steps; one with a question (the card says "answer in that session"
  and has no write control); a stale one that leaves "Working now" and shows in Done; the drawer opens
  from each.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- On the deployed board, with the config repo's client from the same date: a real interactive
  session shows its goal and steps within five minutes, a question shows under "Needs you" with its
  text, and after the session stops its card leaves "Working now" at once.
- The owner compares the deployed page with `BoardV2.dc.html`, `BoardV2Dark.dc.html`,
  `PhoneV2.dc.html` and `PhoneV2Drawer.dc.html`.

*Changed while building:*

- Built: `needs_you`, `after_answer`, `needs_you_at` (migration 0006); `ask_human` on a key of another
  type sets `needs_you` and errors on a done item; `SESSION_AGENT` and the 15-minute session expiry in
  `isExpired`, `isHeartbeatExpired` and `EXPIRED_ROWS`; page cards, drawer, history words, English and
  German strings, ten new palette keys; seed `SESSION_SEED_ITEMS`.
- The DTO stays flat: the page groups Needs you / Working now / Done in `web/src/model.ts`. `/api/board`
  carries no group lists (Slice 14 adds the domain grouping).
- "No goal" = no `why`, no steps, and a title ending " · <project>" (the client's fallback, documented
  in `docs/clients.md`).
- History notes: the marker, then "\n", then the caller's note.
- An item with an open question counts under Needs you, not in `working_count`.
- Decision (coordinator, after two failed fix rounds): a question clears on `needs_you: null`, on done,
  or on a move to `in_progress` from any other status, stale included (a session that asked is idle
  until answered); a repeated `in_progress` keeps it. Clients send `needs_you: null` when the owner
  answers. The rule lives only in `answersQuestion` in `src/domain/upsert.ts`.

*Checks on the final code:* typecheck and lint clean; npm test green, e2e 195 passed 3 skipped. Browser
run (`reviews/wave8-s13-browser`): 8 of 9 items; values desktop 79/89 light and dark, phone 67/78.
Misses: the 1.5px border renders as 1px (as in Slice 11), drifting minute counts, and script selectors.
The doubled seed history note was fixed after the run and not re-run in a browser.

*From review:*

- Applied: high #1, 2, 3, 5, 6, 7, 9; medium #1-5; check #1, 3, 4. Check pass 2 applied none (see below).
- Skipped #4 (`reviews/pr-75-high.md`): "Stale session cards never leave the board" - main already keeps
  stale items on the board; Slice 14's done group settles the window.
- Skipped #8 (`reviews/pr-75-high.md`): "two overlapping reports can disagree" - low, two overlapping
  reports for one key, no failure seen.
- Skipped #6 (`reviews/pr-75-medium.md`): "hasNoGoal compares the fallback title" - low,
  `docs/clients.md` defines the fallback title with the project id.
- Skipped #7 (`reviews/pr-75-medium.md`): "Detail/SessionDrawer is chosen from live data" - low, focus
  return when the dialog kind swaps; follow-up.
- Skipped #2 (`reviews/pr-75-check-medium.md`): "hasOpenQuestion hides a question once heartbeat is older than expiry" - the slice's
  Decided-at-the-desk bullet says the question leaves after the configured expiry.
- Skipped #5 (`reviews/pr-75-check-medium.md`): "hasNoGoal detects the client fallback title" - low.
- Skipped #6 (`reviews/pr-75-check-medium.md`): "questionOrder/waitingOrder/flightOrder and question filters near-duplicated" - low.
- Check pass 2 (`reviews/pr-75-check-2-medium.md`): none applied; "after the second check pass only crash,
  data-loss, security, privacy or loading-state findings reopen the code", so all 9 go to the follow-up
  list below.
- Check pass 3 (`reviews/pr-75-check-3-medium.md`, on the seed fix): 6 low findings, none applied
  (after the second check pass only crash, data-loss, security, privacy or loading-state findings
  reopen the code); they join the follow-up list: seed test counts, unique-key checks skipping
  `SESSION_SEED_ITEMS`, empty seed fields sent as undefined, no seed of `ask_human` on an existing
  item, seeded session cards go stale 15 minutes after seeding, hard-coded history markers in the seed.

*Follow-ups from check pass 2 (`reviews/pr-75-check-2-medium.md`), not fixed:*

- #1 `src/api/board.ts:139`: `working`/`working_count` drop any in-progress item with an open question,
  for every item type.
- #2 `src/domain/upsert.ts:106`: a report with `needs_you` and status done stores a question on a done
  item.
- #3 `src/application/board.ts:96`: `askOnItem` does not reject Part or doc-synced items; a blank `why`
  replaces an open question and resets `needs_you_at`.
- #4 `web/src/SessionDrawer.tsx:148`: a question on a non-session item shows `why` as purpose and all
  `details_md` lines as "Done so far" bullets.
- #5 `src/api/board.ts:112`: `hasOpenQuestion` is computed twice per item.
- #6 `src/infrastructure/d1Repository.ts:120`: the `EXPIRED_ROWS` CASE prevents index range use; no
  query-plan test.
- #7 `web/src/cards.ts:99`: a caller note starting with `needs_you: ` renders as a question event.
- #8 `web/src/time.ts:9`: an unparseable timestamp shows "waiting NaN min".
- #9 `web/src/model.ts:53` and `docs/clients.md:514`: `LAST_TIME` sorting with U+FFFF; the heartbeat
  guidance "every 30 minutes is safe" contradicts the 15-minute session expiry.

#### For CLAUDE.md (lifted 2026-11-17)

- Session expiry is `SESSION_AGENT` / `SESSION_STALE_AFTER_MINUTES` in `src/domain/stale.ts`, kept equal
  to `EXPIRED_ROWS` by `test/stale.test.ts`; change both together (Slice 13:
  docs/plan/slices/13-session-cards.md).
- The question-clearing rule lives only in `answersQuestion` in `src/domain/upsert.ts`; never copy it
  (Slice 13: docs/plan/slices/13-session-cards.md).

#### Not yet verified

- On the deployed board, a real session's goal and steps show within 5 minutes.
- On the deployed board, a question shows under Needs you with its text.
- On the deployed board, a stopped session leaves Working now at once.
- The owner's comparison of the deployed page with the mocks.
- The drawer history of a working card with several events, in a browser.
- The 1.5px border (renders as 1px in the browser run).
