### Slice 9 — What 1% of the cap costs, per model

Source: the owner at the desk, 2026-11-16 ("the dashboard should be able to guess the consumption
rate ... 1 agent is using [one model], and it uses 2 million tokens, then the weekly usage goes
up 5% ... each 400k token would then cost 1% of my plan").

*Planned.* Needs [Slice 8](08-usage-reports.md) part A. The numbers on the page wait for the
owner's design mock.

**Touches:** `src/domain/capCost.ts`, `src/application/usage.ts`, `src/api/usageDto.ts`,
`src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`

#### Why

Knowing the tokens is half the answer. The owner wants to know how much of the plan each model
eats: "this many tokens of this model cost 1% of the week", and from that what each task, agent
kind and step cost in percent.

#### Decisions (owner, 2026-11-16)

- **Best fit over many time windows, not an exact solve.** The owner's idea (three models, three
  points in time, three equations) is right in spirit. The unknowns are more than one per model,
  because the four token kinds are charged differently, so a few readings would give wild
  answers. The board collects many stretches of time and finds the weights that fit them best.
- **A "how sure" label** next to every estimate, which improves as data grows.
- **Only the growth of the percentage matters, and the plan.** A stretch of time counts only
  when it lies inside one cap window on one plan, with an accepted cap reading at each end. A
  stretch that contains a reset or a plan change is left out, so a reset can never produce a
  negative cost. How long a window lasts plays no part.
- **Weights are worked out per plan.** Moving to another plan starts that plan's own estimate;
  coming back picks the old one up again.
- **Cost is never reset.** A task's cost in percent is its tokens times the weights, added up
  over its whole life, across resets.

#### Decided at the desk (not the owner's choices)

- The fit never gives a negative weight (a model cannot give cap back).
- **Start coarse, get finer.** With few stretches of time the board fits one weight per model
  (all tokens together) and says so. When there are enough stretches (at least three times the
  number of unknowns, in config) it fits a weight per model and token kind. The label names
  which of the two is shown.
- **Use the board cannot see** (the chat app, a phone, another machine without the client) also
  raises the cap. The fit keeps a leftover figure per stretch; the page shows the share of cap
  growth it could not explain, so a bad fit is visible instead of being blamed on a model.
- A stretch is used only when it is at least as long as the reporting interval and the cap rose
  by a measurable amount; several short stretches in a row are joined. Usage samples are lined
  up with cap readings by the nearest sample at or before the reading.
- The fit runs in the Worker when the usage route is read, as a pure function in `src/domain`.
  If it takes too long on real data, store the result in the cron instead and write the timing
  into this file.

#### Work

**A. Server**

- [ ] **A1.** `src/domain/capCost.ts`: build the stretches of time from cap readings and usage
      samples (the rules above); pure, with tests for a reset inside a stretch, a plan change,
      a missing reading, joined short stretches.
- [ ] **A2.** The non-negative best fit, coarse and fine, with the leftover figure and the
      "how sure" inputs (number of stretches, size of the leftover). Tests with made-up data
      where the true weights are known: one model alone (the owner's 2 million tokens and 5%
      case must give 400,000 tokens per 1%), three models at once, noise, unseen use.
- [ ] **A3.** The usage route returns, per plan: tokens per 1% for each model (and kind when
      fine), the label, the unexplained share, and cost in percent per task, agent kind and
      step for a time range.
- [ ] **A4.** `docs/clients.md` and README: what the estimate needs from a client (regular cap
      readings with the plan name) and what it cannot see.

**B. On the usage page (after the mock)**

- [ ] **B1.** Rewrite this part to match the mock once it is in `docs/design/`.
- [ ] **B2.** "1% of the week on this plan is about N tokens of model M", the label, the
      unexplained share, and cost per task and per agent kind in percent.
- [ ] **B3.** Browser tests against a faked route.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1 and A2.
- With a faked week that contains a reset from 99% to 0%, no weight and no task cost is
  negative, and the task's cost before the reset is still counted after it.
- On the deployed board after some days of real reports: the estimate for a model that ran alone
  for a stretch matches a hand calculation from the page's own numbers.
