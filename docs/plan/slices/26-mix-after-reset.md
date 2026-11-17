### Slice 26 — The "all kinds" cost figure stays steady across a weekly reset

*Parked: feedback loop, waits for the user.* Found by the feedback loop of night 2026-11-17-1826
([note](../notes/2026-11-17-1826-feedback-loop.md)); not to be built by a night until the owner says so.

**Why:** on 2026-11-17 the owner saw the usage page's figures drop right after a weekly cap reset and thought the
reset had wiped history. The session that answered read the live D1: no token rows were lost and the reset was
Claude's own. It named one figure that does start over at a reset: in the
"Tokens that use 1% of the week" table, **"All kinds, this window's mix"** is weighted by the current window's mix
(`src/api/usageDto.ts:63`), and an hour after a reset that mix is an hour of use. The fit itself never crosses a reset
(`buildStretches` in `src/domain/capCost.ts:124-133`). The session ended on a question ("which number dropped?")
instead of running the read-only comparison itself.

**Work (to settle with the owner first):**

- [ ] Run the comparison read-only: the "all kinds" figure from the readings before the reset against the one after,
  on the live data. This needs no owner answer and any session may do it first (the feedback loop did not: the figure
  is computed inside the Worker per read, behind Access, and the loop had no time left to recompute it locally).
  Verify: this file records both numbers.
- [ ] If the figure jumps, pick what it is weighted by when the window is young (the owner's choice: the last full
  window's mix, the last 7 days, or the current mix with a "window is N hours old" hint). Verify: a domain test with a
  reset an hour old shows a steady figure.

**Touches:** `src/domain/capCost.ts`, `src/api/usageDto.ts`, `web/src/**`, `test/**`

**Migrations:** none
