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
3. **Per-model caps (item 4), from the code; to confirm against live readings after deploy.** A cap reading whose
   window kind is `weekly:<model>` (whole hyphen-split name parts of the model, case ignored; every matching model, not
   only the first: `ownCapModels` in `src/domain/cap.ts`) is that model's own cap. Such a model is left out of the shared `weekly` fit (its use is removed before
   `buildStretches`) and fitted on its own window from its own use only (`fitOwnCap`, one weight, its points are points
   of its own cap). It is shown in the table but never compared with another model (no multiple, never the comparison
   base), and its cost on the shared cap is unknown (null, never 0). Too few stretches: a dash, "Not enough data".
4. **How the other items were built.** Item 2: a stretch is evidence for a model when its tokens are at least
   `modelMinShare` (2%) of the stretch's tokens; below `modelMinStretches` (4) of them the model's cells are a dash and
   its cost is null. Item 3: a kind under `minKindShare` (1%) of a model's tokens has no column and takes the model's
   mean weight (a kind with no tokens stays a dash; such a kind is fitted at weight 0 but priced at that mean, a known
   gap left on purpose); a ridge term (`ridge`, 0.001) is also available on the weights.
   Item 5: the intercept is a column of days (`untrackedRidge` 20 holds it back so tokens explain what they can); the
   shown unexplained residuals still leave it out, so chat placement is unchanged. The page shows it as "Untracked use"
   in the tokens-per-1% table (desktop `UntrackedRow`, phone `PhoneUntracked`, `web/src/CapCostSection.tsx`).
   Config under `usage.capCost` (defaults in `src/config.ts`, shown in `config/board.example.json`): `fitFrom` null
   (all history; the example file shows `2026-01-01`), `modelMinStretches` 4, `modelMinShare` 0.02, `ridge` 0.001,
   `untrackedRidge` 20, `minKindShare` 0.01. `fitFrom` takes a date (UTC midnight) or a time with a zone; a zoneless
   time is read as UTC; a bad value is logged and means all history (`readFitFrom`).
5. The "Untracked use" row has no mock; it reuses the model-row styles from docs/design/ (review 2026-11-27).

## Work

*Built 2026-11-27 (items 1 to 6), not merged; the live checks under Not yet verified are open.*

*Changed while building:* the own-cap rule (Decisions 3) is read from the code, not from live cap readings; it still has
to be confirmed. The "Untracked use" row is outside the slice's first Touches line (web dash and "not enough data" text
only); Decisions 5 records it.

*From review:* two passes, findings read in full.

- High (`reviews/s67-high.md`, 3 important, 6 nits): applied #1, #2, #3, #6, #7, #8.
- Skipped #4 (`reviews/s67-high.md`): "priced at the token-weighted mean of the model's other kinds" - left as minor by
  the fixer; a kind under `minKindShare` is fitted at weight 0 but priced at the model's mean weight (Decisions 4).
- Skipped #5 (`reviews/s67-high.md`): "makes a whole task, agent, step or environment key null" - this is the repo's
  null-never-0 cost rule (Decisions 2, Slice 9), kept on purpose.
- Skipped #9 (`reviews/s67-high.md`): "O(n) lookup per evidence stretch per model" - left as minor by the fixer (a speed
  point, no wrong figure).
- Medium (`reviews/s67-medium.md`, 2 important, 5 nits): applied #1, #2 (the row is recorded in Decisions 5), #3, #4.
- Skipped #5 (`reviews/s67-medium.md`): "Gate on stretch count before fitting" - repeat of high #9, minor.
- Skipped #6 (`reviews/s67-medium.md`): "fitted at weight 0 but priced at the model mean" - repeat of high #4, left on
  purpose (now recorded in Decisions 4).
- Skipped #7 (`reviews/s67-medium.md`): "returns null for a whole task, step or environment" - repeat of high #5, the
  null-never-0 rule.

- [x] **1. Fit start date.** Optional `usage.capCost.fitFrom` (ISO date) in `CapCostConfig`; `fitFor` drops history
  deltas and cap windows before it before `buildStretches`. Absent means today's behaviour. The example config shows
  it. Set it to `2026-11-19` in the owner's private config at build time (the day after the last usage fix), and read
  the live page after the deploy.
- [x] **2. Per-model evidence floor.** A model's weights show only when it has its own minimum of stretches with
  non-trivial token share (new config value, e.g. `modelMinStretches`); below it, its cells are a dash with "not
  enough data". `howSure` works per model.
- [x] **3. Collinear kinds are bounded.** Add a small ridge term (config) or merge kinds whose columns move together
  so no per-kind weight runs away; a kind with under a set share of a model's tokens (fresh input today) uses the
  model's single weight, not its own column.
- [x] **4. Per-model caps.** A model with its own cap kind (`weekly:<model>`) is fitted against that window, or left
  out of the `weekly` fit, whichever matches how the cap counts it; read the cap readings first and write the rule
  found into the Decisions here.
- [x] **5. Unexplained growth.** Growth no tokens explain goes to an intercept column (shown as "untracked use"), not
  into the model weights.
- [x] **6. Tests.** A thin model shows a dash; collinear kinds stay bounded; `fitFrom` drops older stretches; a
  per-model cap is fitted on its own window; the fit's timing test still passes.

## Verify

- With the live data of 2026-11-26 replayed in a test fixture (counts only, no names), Haiku's "All kinds" is below
  Opus's and no cell exceeds a sane bound.
- After the deploy, the live usage page shows Haiku cheaper than Opus, or a dash where the data is too thin.

#### For CLAUDE.md

- The cap-cost evidence floor (`evidenceIndexes`, `thinModels` in `src/domain/capCost.ts`) and the own-cap split
  (`ownCapModels` in `src/domain/cap.ts`, `ownCapKinds` / `fitOwnCap` in `src/domain/capCost.ts`) live only in those
  functions; never a second copy in `src/application/usage.ts` or `web/` (Slice 67:
  docs/plan/slices/67-believable-cap-cost.md).
- `usage.capCost.fitFrom` filters history before `buildStretches` (`fromFitStart` in `src/domain/capCost.ts`) and
  deletes nothing; never cut old rows to change the fit (Slice 67: docs/plan/slices/67-believable-cap-cost.md).
- The "Untracked use" row reuses the model-row styles of the cap-cost table (`UntrackedRow` / `PhoneUntracked` in
  `web/src/CapCostSection.tsx`); it has no mock of its own (Slice 67: docs/plan/slices/67-believable-cap-cost.md).

#### Not yet verified

- [owner] Set `usage.capCost.fitFrom` to `2026-11-19` in the live `BOARD_CONFIG` (the owner's private config; the example
  file holds a placeholder).
- [chrome] After the deploy and that config, the live usage page shows Haiku cheaper than Opus, or a dash where the data is too thin.
- [chrome] The own-cap rule (Decisions 3) matches the live `weekly:<model>` cap readings; read the readings and the page
  after the deploy and write the result into Decisions 3.
