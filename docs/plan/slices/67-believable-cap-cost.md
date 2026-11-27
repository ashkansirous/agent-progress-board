### Slice 67 — The cap-cost table shows only believable numbers

*Planned 2026-11-26 from the owner's report: the usage page said Haiku costs 18.1x Opus.*

**Product:** agent-progress-board.

**Touches:** `src/domain/capCost.ts` (`buildStretches`, `planFit`, `nnls`, `solve`, `howSure`), `src/application/usage.ts`
(`fitFor`, `historyStart`, the cap-cost cells near `ratioReference`), `src/config.ts` (`CapCostConfig`, `readCapCost`),
`config/board.example.json`, `test/capCost.test.ts`, `test/usageTools.test.ts`, `src/domain/prices.ts`,
`src/api/usageDto.ts`, `test/capCostPrices.test.ts`, `test/capCostFormat.test.ts`, `e2e/usage.spec.ts`,
`e2e/usageFixture.ts`, `web/src/strings.ts` (the list-price notes), `web/` cap-cost table (dash and "not
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
6. **Model gaps are anchored to the published prices (owner, 2026-11-27: "anchor it").** Items 1 to 6 went live and a
   replay of the live data with `fitFrom` 2026-11-19 still gave Haiku 16.3x Opus per token. The models run together
   (helper agents inside one session), so the cap growth cannot tell them apart; more data will not fix it. The fit
   therefore starts from the list-price ratios between models and kinds and fits only how many tokens 1% of the cap
   is; a model moves off its price ratio only as far as the data clearly says (a strong shrink toward the prior). The
   page says the gaps between models come from list prices. Owner chose this over "measure only, dash when models move
   together".
   The list-price notes have no mock; they reuse the existing note styles (review 2026-11-27).
   Live replay 2026-11-27 (item 7 code, after the high review): tokens per 1% on All kinds Sonnet 85.6M, Opus 95.8M;
   Haiku is a dash, "Not enough data" (under the evidence floor; before the floor applied to priced models it showed
   1,088M). Per kind the order is Haiku, Sonnet, Opus; Sonnet's All-kinds mix leans on output and cache write, so on
   All kinds it sits about 10% behind Opus, accepted.

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
- Price-prior pass (`reviews/s67b-medium.md`, 1 important, 4 nits): applied #1 and #4.
- Skipped #2 (`reviews/s67b-medium.md`): "src/domain/capCost.ts:332, nit. Every priced model is forced into FitMode.PerKind, so kind_ratios shows list-price ratios as if measured, and no "one weight so far" note shows for a priced model with few stretches." - the list-price note covers it.
- Skipped #3 (`reviews/s67b-medium.md`): "src/domain/capCost.ts:555, nit. evidenceOf lets a priced collinear model pass on its list-price weight alone (weight = scale x price, non-zero), so it shows a figure with no measurement behind it (e.g. Haiku only inside Opus sessions)." - prior-backed by design, Decisions 6.
- Skipped #5 (`reviews/s67b-medium.md`): "src/config.ts:372, nit. readPrices always starts from DEFAULT_PRICES; a config cannot drop a default, and a bad entry with a default's name silently keeps the default." - a nit with no wrong figure: the kept default is the list price, and a bad entry is logged.

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
- [ ] **7. Anchor model gaps to list prices (Decisions 6).**
  - Price table: list prices per model family and kind (input, output, cache write, cache read), as public defaults
    in `src/domain/` matched by whole model-name parts (the same matching as `ownCapModels`). Values of 2026-11-27:
    Opus 5.5 $4 / $20, cache read $0.20; Sonnet 5.5 $2 / $10, cache read $0.10; Haiku 5.5 $0.10 / $0.50, cache read
    $0.01; Fable 5.2 $8 / $40, cache read $0.20; cache write 1.25x input. `usage.capCost.prices` in config overrides
    or adds entries.
  - Fit: each model's kind weights are its price vector times one shared scale plus a per-model factor shrunk hard
    toward 1 (config `priceShrink`). A model with no price entry keeps today's fit.
  - Page: one short note on the table saying the gaps between models come from list prices; a model whose fitted
    factor moves more than a set amount off 1 shows that.
  - Tests: a fixture where the models' use moves together (as live) gives Haiku cheaper than Sonnet cheaper than
    Opus, in their price order; a fixture with separable use still lets a clear factor through; the timing test passes.

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
- Model prices are matched only by `priceOf` in `src/domain/prices.ts`; never a second copy (Slice 67:
  docs/plan/slices/67-believable-cap-cost.md).

#### Not yet verified

- [chrome] After item 7's deploy, the live usage page shows Haiku cheaper than Opus, or a dash where the data is too
  thin. (2026-11-27, items 1 to 6 live with `fitFrom` 2026-11-19 set in `BOARD_CONFIG`, copy in the secrets store: a
  replay of the live data through the deployed code gave Opus 302.7M tokens per 1%, Sonnet 56.7M, Haiku 18.6M, so
  Haiku at 16.3x Opus; Fable no row, its only data predates `fitFrom`.)
- [chrome] The own-cap rule (Decisions 3) matches the live `weekly:<model>` cap readings; read the readings and the page
  after the deploy and write the result into Decisions 3.
