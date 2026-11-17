### Slice 26 — The "all kinds" cost figure stays steady across a weekly reset

*Planned with a recorded default (starter session, 2026-11-17, after the owner's "what the fuck is the question ...
what the fuck do you need from me?" on bare "Waiting on you" cards): the choice below has an obvious answer, so it is
not asked.* Found by the feedback loop of night 2026-11-17-1826 ([note](../notes/2026-11-17-1826-feedback-loop.md)).

**Decision (default, owner may overrule):** while the current window is younger than 24 hours, "All kinds" is
weighted by the last full window's mix, and the row says so ("last week's mix until this week has a day of use");
after 24 hours it uses the current window's mix as now. Reason: it keeps the figure steady across a reset, needs no
new data, and still shows the current mix once there is enough of it.

**Why:** on 2026-11-17 the owner saw the usage page's figures drop right after a weekly cap reset and thought the
reset had wiped history. The session that answered read the live D1: no token rows were lost and the reset was
Claude's own. It named one figure that does start over at a reset: in the
"Tokens that use 1% of the week" table, **"All kinds, this window's mix"** is weighted by the current window's mix
(`src/api/usageDto.ts:63`), and an hour after a reset that mix is an hour of use. The fit itself never crosses a reset
(`buildStretches` in `src/domain/capCost.ts:124-133`). The session ended on a question ("which number dropped?")
instead of running the read-only comparison itself.

**Work:**

- [ ] Run the comparison read-only: the "all kinds" figure from the readings before the reset against the one after,
  on the live data. This needs no owner answer and any session may do it first (the feedback loop did not: the figure
  is computed inside the Worker per read, behind Access, and the loop had no time left to recompute it locally).
  Verify: this file records both numbers.
- [ ] Apply the decision above (whether or not the comparison shows a jump; a young window always has a thin mix).
  Verify: a domain test with a reset an hour old shows the figure equal to the last full window's; one 30 hours old
  uses the current mix; the row's note text is shown on the page (e2e).

**Touches:** `src/domain/capCost.ts`, `src/api/usageDto.ts`, `web/src/**`, `test/**`

**Migrations:** none
