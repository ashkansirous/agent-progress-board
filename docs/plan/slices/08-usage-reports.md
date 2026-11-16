### Slice 8 — Usage reports: tokens per model, cap readings, usage page

Source: the owner at the desk, 2026-11-16 ("I want to have an understanding of how my weekly cap
is being consumed ... every few minutes, the agents would report to the dashboard, how much token
they are consuming via which model and also report which task, which action").

*Planned.* Part A (server) can be built now. Part B (the page) waits for the owner's design mock.

**Touches:** `migrations/0003_usage.sql`, `src/domain/usage.ts`, `src/domain/cap.ts`,
`src/application/usage.ts`, `src/application/ports.ts`, `src/infrastructure/d1Repository.ts`,
`src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/api/router.ts`, `src/api/usageDto.ts`,
`src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`

#### Why

The owner's agents run on several models, and each model uses up the subscription's weekly cap
at a different rate. Today nothing shows which model, agent or task used how much. The coding
tool already records, for every message, the model and four token counts (fresh input, written
to cache, read from cache, output), with one record file per helper agent (checked 2026-11-16 on
the owner's machine). So a client can send exact numbers; no agent has to count.

This slice stores those numbers and the cap readings and shows them. Working out what 1% of the
cap costs is [Slice 9](09-cap-cost-estimate.md).

#### Decisions (owner, 2026-11-16)

- **A script sends the numbers, not the agents.** The client reads the tool's own records and
  sends totals about every five minutes while work runs, and once when an agent stops. The
  client is planned in the owner's private config repo; this repo gives it tools and the guide.
- **The four token kinds are stored separately** (fresh input, cache write, cache read, output),
  per model. One example message had 4 fresh, 1,025 cache write, 94,256 cache read and 56 output
  tokens, so adding them together would hide what matters.
- **Totals so far, not differences.** A usage report carries the running totals of one agent on
  one model, with the time of the newest record it counted. Sending the same report twice
  changes nothing, a lost report is healed by the next one, and the use between any two times is
  a subtraction. This keeps the rule "one upsert keyed by a stable key" (`CLAUDE.md`).
- **Each report says what the tokens were for:** the item key of the task (a slice or a slice
  part), the agent's kind (for example a reviewer), and the step it was on when known. Helpers
  an agent starts report under the same task with their own model.
- **Cap readings are a separate report:** the time it was taken, the subscription plan's name,
  and for each window the client can read (the weekly one, any shorter one, any per-model one)
  the percentage used, with decimals, and the reset time when known.
- **The plan name is recorded on every cap reading.** The owner may move to a smaller plan and
  back; 1% of one plan is not 1% of another. Plan names are data from the client, never written
  in this repo.
- **A reset is an event, not a week.** Resets happen weekly, and the provider sometimes offers
  an extra reset mid-week or may move the start of the week. The board does not care how long a
  window lasts. It cares about the percentage going up inside one window, and on which plan.
- **Stale readings never pull the number down.** Readings are ordered by the time they were
  taken. Inside one window a reading lower than one already stored is dropped as stale. A lower
  reading starts a new window when its reset time differs from the stored one, or, when no reset
  time came with it, when it falls to the low mark (config, default 2%) from above it. So 98% to
  1% is a reset, and 60% to 55% is a stale reading.
- **Cost is never reset.** What a task has used stays with the task across resets and plan
  changes.
- **Private data.** Token numbers, model names, plan names and task keys live only in the
  owner's database behind the same gates as items. Examples in this repo use made-up values.
- **Design:** the owner makes a mock for the usage page first; the page is built to match it
  (the mock wins over this file). Until the mock is in `docs/design/`, part B is not started.

#### Decided at the desk (not the owner's choices)

- Two new MCP tools, both write-token only: `report_usage` and `report_cap`. The page reads
  through one new read route that calls the same application functions, behind the same Access
  check as `/api/board`.
- Two new tables in migration 0003: usage samples (agent key, model, time, the four running
  totals, task key, agent kind, step) and cap readings (time taken, plan, window kind, percent,
  reset time, source, accepted or dropped with the reason). Both append-only.
- The agent key is `<project>/session-<id>` for a main session and
  `<project>/session-<id>/agent-<id>` for a helper, in line with the keys in `docs/clients.md`.
- A running total that goes down for the same agent and model is stored as a restart (the
  difference counts from zero), never as negative use.
- Old samples are thinned by the existing cron: after the keep-time in config (default 30 days)
  only one sample an hour is kept per agent and model. The free-tier row limits from Slice 1
  decide the default; write the measured row counts into this file while building.

#### Work

**A. Server (no design needed)**

- [ ] **A1.** Migration 0003 with the two tables and their indexes (by time, by task key).
- [ ] **A2.** `src/domain/usage.ts`: the use between two times from running totals, per model
      and kind, including the restart case. Pure, with tests.
- [ ] **A3.** `src/domain/cap.ts`: the reading rules above (order by time taken, drop stale,
      detect a reset, split into windows, plan changes). Pure, with tests for: 98 to 1 with a
      new reset time, 60 to 55 with the same reset time, a late-arriving older reading, a reset
      with no reset time, a plan change mid-window.
- [ ] **A4.** `report_usage` and `report_cap` tools with schemas and limits, calling the
      application layer; the repository port and its D1 code.
- [ ] **A5.** The read route for the page: totals per model and kind, per task and per agent
      kind, for a time range, plus the accepted cap readings and the windows they fall in.
- [ ] **A6.** `docs/clients.md`: both tools, the keys, "totals so far", what to send and how
      often, the fail-open rule again. README line.
- [ ] **A7.** Thinning of old samples in the cron, with a test.

**B. Usage page (after the mock)**

- [ ] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it.
- [ ] **B2.** The page gets a second view (usage) and a way to move between views; a loading
      state for any wait over 500 ms, the empty and failed states from the existing design.
- [ ] **B3.** Tokens per model and kind over time, per task and per agent kind, with the cap
      line and its resets marked.
- [ ] **B4.** Browser tests against a faked read route, phone and desktop sizes.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green, with the cases named in A2 and A3.
- Sending the same `report_usage` twice leaves one sample's worth of use; a `report_cap` with a
  lower percentage and the same reset time is stored as dropped and does not change the page.
- On the deployed board: a real client run shows tokens for at least two models under the right
  task, and the weekly percentage with its reset time. Any check that writes to the live board
  removes its own rows in the same run (`plan.md`, *Outstanding work*).
- `npm run test:e2e` green for part B.
