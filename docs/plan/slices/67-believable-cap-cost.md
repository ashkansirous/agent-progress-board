### Slice 67 — The cap-cost table shows only believable numbers

*Planned 2026-11-26 from the owner's report: the usage page said Haiku costs 18.1x Opus.*

**Product:** agent-progress-board.

**Touches:** `src/domain/capCost.ts` (`buildStretches`, `planFit`, `nnls`, `solve`, `howSure`), `src/application/usage.ts`
(`fitFor`, `historyStart`, the cap-cost cells near `ratioReference`), `src/config.ts` (`CapCostConfig`, `readCapCost`),
`config/board.example.json`, `test/capCost.test.ts`, `test/usageTools.test.ts`, `web/` cap-cost table (dash and "not
enough data" text only)

## Why

The owner's screenshot of 2026-11-26 shows the "What 1% of the cap costs" table with claude-haiku-5-5 at 18.1x Opus
overall, Haiku cache write 185x, Fable fresh input 159,357x, Sonnet fresh input 72,675x, and Opus's own fresh input,
cache read and output as a dash. Haiku is far cheaper than Opus, so the fit is wrong. No row is bad: the data read live
the same day has no zero, negative or duplicate rows. The fit is fed too little signal, and nothing stops it from
showing nonsense.

What the code and data showed (2026-11-26, origin/main 7c1c438):

- The fit's only guard is non-negativity (`nnls`, `src/domain/capCost.ts:212`); no plausibility bound, no ridge term.
- Kinds that move together (fresh input and cache write) trade weight freely once a model gets per-kind weights (12
  stretches, `planFit` :266). Fresh input is tiny for every model (Fable 1,970 tokens in all, Opus 76,452 next to 6.72B
  cache read), so its weight can grow without bound.
- Growth no reported tokens explain (chat, Design) is forced onto whichever model columns exist (no intercept); Opus's
  weights were driven to 0, which is the dashes.
- A model with few stretches still shows a weight: Fable has 289 samples over 15 hours, all in the first, partial
  window. `howSure` labels every model from the global stretch count and error, not its own fit (:359, :384).
- Fable has its own cap reading (`weekly:fable`, 12 to 22% in window 1, 0 since), but the fit uses only `weekly`
  (`buildStretches` :141), so Fable's tokens are fitted against a cap they may not be counted in.
- The fit uses all history up to `keepDays` (30). There is no way to leave old data out except lowering `keepDays`,
  which also deletes it (`thinOldUsage`). Rows from 2026-11-16 to 11-18 predate the last usage fixes (Slices 35 and 47).

## Decisions

1. **No data is deleted.** Old samples stay; the fit gets a start date instead (owner asked about a reset 2026-11-26;
   deleting cannot be undone, a start date can).
2. A number the fit cannot back is a dash with a short reason, never a figure (same rule as Slice 9's null cost).

## Work

- [ ] **1. Fit start date.** Optional `usage.capCost.fitFrom` (ISO date) in `CapCostConfig`; `fitFor` drops history
  deltas and cap windows before it before `buildStretches`. Absent means today's behaviour. The example config shows
  it. Set it to `2026-11-19` in the owner's private config at build time (the day after the last usage fix), and read
  the live page after the deploy.
- [ ] **2. Per-model evidence floor.** A model's weights show only when it has its own minimum of stretches with
  non-trivial token share (new config value, e.g. `modelMinStretches`); below it, its cells are a dash with "not
  enough data". `howSure` works per model.
- [ ] **3. Collinear kinds are bounded.** Add a small ridge term (config) or merge kinds whose columns move together
  so no per-kind weight runs away; a kind with under a set share of a model's tokens (fresh input today) uses the
  model's single weight, not its own column.
- [ ] **4. Per-model caps.** A model with its own cap kind (`weekly:<model>`) is fitted against that window, or left
  out of the `weekly` fit, whichever matches how the cap counts it; read the cap readings first and write the rule
  found into the Decisions here.
- [ ] **5. Unexplained growth.** Growth no tokens explain goes to an intercept column (shown as "untracked use"), not
  into the model weights.
- [ ] **6. Tests.** A thin model shows a dash; collinear kinds stay bounded; `fitFrom` drops older stretches; a
  per-model cap is fitted on its own window; the fit's timing test still passes.

## Verify

- With the live data of 2026-11-26 replayed in a test fixture (counts only, no names), Haiku's "All kinds" is below
  Opus's and no cell exceeds a sane bound.
- After the deploy, the live usage page shows Haiku cheaper than Opus, or a dash where the data is too thin.
