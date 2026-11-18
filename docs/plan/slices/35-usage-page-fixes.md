### Slice 35 — Usage page and cost figures: review leftovers

*In progress (wave 2026-11-18), draft PR.*

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 2.

**Touches:** `src/domain/usage.ts`, `src/domain/capCost.ts`, `src/application/usage.ts`, `src/config.ts`,
`web/src/theme.ts`, `web/src/CapCostSection.tsx`, `web/src/capCostFormat.ts`, `web/src/usageFormat.ts`,
`web/src/AgentKindCost.tsx`, `web/src/TokenChart.tsx`, `web/src/usageView.tsx`, `web/src/strings.ts`,
`test/usage.test.ts`, `test/capCost.test.ts`, `test/capCostFormat.test.ts`, `test/usageWeb.test.ts`,
`test/config.test.ts`, `web/src/SourcesSection.tsx`, `web/src/CapLine.tsx`, `docs/plan/slices/35-usage-page-fixes.md`

**Migrations:** none

#### Why

These are the open follow-ups of Slices 8 and 9, the domain items of Slice 16, and the web items of Slices 26 and 28.
The ones that can give a wrong result:
- a 30-day range across a daylight-saving change uses one offset;
- an unbounded `record_at` makes `bucketKeys` loop once per hour;
- growth under 0.05 is dropped but not put into the residual;
- window times are compared as strings against parsed times;
- the cap-points bar takes a negative width.

#### Decisions

- No change, because they match a root `CLAUDE.md` rule: Slice 9 #3 (every read refits the whole history; cap cost
  is derived at read and bounded) and Slice 9 #4 (cap points are null when any model in the plan history has no
  fitted weight; "a cost with an unfitted model is null, never 0").
- Slice 9's German Block 3 needs a native speaker's read (`web/src/strings.ts:533-535`). That is the owner's step,
  listed in plan.md's *Outstanding work*, not code work.

#### Work

Usage domain (Slice 8):
- [ ] #1: the whole range uses one fixed `offsetMinutes` (`src/domain/usage.ts:161-176`;
  `src/application/usage.ts:206`). Work the offset out per bucket.
- [x] #4: `record_at` has no bound, and `bucketKeys` loops once per hour (`usage.ts:171`; `from = rangeStart`,
  `src/application/usage.ts:202`). Clamp the range in the application layer.
- [x] #5: `splitByBucket` uses `indexOf`, which is O(d × b) (`usage.ts:193`).

Cap cost (Slice 16, Slice 26):
- [x] Growth under 0.05 is dropped but not added to the residual (`src/domain/capCost.ts:23-25,586-601`).
- [x] Window times are compared as strings against parsed times (`:605-621` vs `:589`).
- [x] The window query runs even when the fit is null (`src/application/usage.ts:202`), placement is O(stretches ×
  windows) (`capCost.ts:592`), `isPlaced` is inferred, zero-length windows are possible, and 3+ overlaps are
  untested. Skip the query when the fit is null, and test the rest.
- [ ] Slice 26 chk #1 (probably gone): `mixOf` (`src/application/usage.ts:504-510`) now falls back per model. Add the
  test that shows one model without last-week use no longer blanks the others, then close the item.

Page (Slices 9, 28, 2):
- [x] Slice 9 c2 #2: when no model has ratios, the phone kinds card has no "not split" note, because
  `web/src/CapCostSection.tsx:413-415` returns null before the note.
- [x] Slice 9 c3 #5, #6: `KindsBlock` writes one sentence for all models (`:315`), and `ratioGroups` is keyed on
  formatted strings (`:452-464`).
- [ ] Slice 9 c3 #1, #2, #7: `kindsSentence`'s second amount lacks the "times as much" phrasing
  (`web/src/capCostFormat.ts:107-115`), the EN and DE wording of `kindsMultipleOf` (`web/src/strings.ts:165,535`),
  and the rounding in `ratioAmount` (`capCostFormat.ts:68-79`).
- [x] Slice 9 c3 #3: `costPercentText` uses "." in German (`web/src/usageFormat.ts:72-74`). Format by locale.
- [x] Slice 9 c3 #4: the cap-points bar width can go negative (`web/src/AgentKindCost.tsx:18-20`). Clamp it at 0.
- [ ] Slice 9 #5 + Slice 2 pr-35 c2 #1: `palettesWithDefaults` bakes the example palettes into the stored config
  (`src/config.ts:332-337`), and the fallback palette is the static example file (`web/src/theme.ts:38-44`).
- [x] Slice 28 #1: the hint shows when any series has no name (`web/src/TokenChart.tsx:278`). Show it only while no
  environment is named, as Slice 28's rule says.
- [x] Slice 28 #3: the `||` in `web/src/usageView.tsx:43-45`.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New tests: a range across the last-Sunday-of-October change; a
  `record_at` ten years out returns at once; residual sums; a German percent with a comma; a negative bar clamped at 0.
- `npm run test:e2e`: the usage page with no ratios shows the "not split" note.
