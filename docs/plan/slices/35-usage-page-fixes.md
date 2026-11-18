### Slice 35 — Usage page and cost figures: review leftovers

*Built 2026-11-18 (night 2026-11-18-1602, wave 2), PR #138, merged 2026-11-18 as eede63a. Placement cloud: the cloud run `cse_012UYzYVMY9PDqmtfMWRDKrB` pushed 5545c0f partially (no CLOUD DONE line; e2e could not run there) and the slice was finished locally. Checks on the final tree: lint, typecheck, vitest 581, plugin 341, e2e 280 passed 4 skipped. Not yet verified on a device in a daylight-saving zone.*

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 2.

**Touches:** `src/domain/usage.ts`, `src/domain/capCost.ts`, `src/application/usage.ts`, `src/config.ts`,
`web/src/theme.ts`, `web/src/CapCostSection.tsx`, `web/src/capCostFormat.ts`, `web/src/usageFormat.ts`,
`web/src/AgentKindCost.tsx`, `web/src/TokenChart.tsx`, `web/src/usageView.tsx`, `web/src/strings.ts`,
`test/usage.test.ts`, `test/capCost.test.ts`, `test/capCostFormat.test.ts`, `test/usageWeb.test.ts`,
`test/config.test.ts`, `web/src/SourcesSection.tsx`, `web/src/CapLine.tsx`, `web/src/TaskCost.tsx`, `web/src/usageApi.ts`,
`web/src/usageQuery.ts`, `src/api/usageDto.ts`, `e2e/usage.spec.ts`, `test/capCostRoute.test.ts`, `web/src/chartGeometry.ts`,
`src/api/router.ts` (the usage route's palette line only; Slice 37 edits other parts), `test/usageTools.test.ts`, `web/src/UsagePage.tsx`,
`web/src/CapTiles.tsx`, `e2e/usageFixture.ts`,
`docs/plan/slices/35-usage-page-fixes.md`

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
- [x] #1 (the page sends `time_zone`; the buckets use the zone's offset at each moment; every surface asks one offset function per moment, `offsetForZone` in `src/domain/usage.ts`: the zone the page sent, else the fixed `utc_offset`; the response echoes `time_zone` so the page uses what the Worker used; hour buckets are real hours, the repeated hour's second pass keyed `...T02#2`, the skipped hour has none): the whole range uses one fixed `offsetMinutes` (`src/domain/usage.ts:161-176`;
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
- [x] Slice 26 chk #1 (probably gone): `mixOf` (`src/application/usage.ts:504-510`) now falls back per model. Add the
  test that shows one model without last-week use no longer blanks the others, then close the item.

Page (Slices 9, 28, 2):
- [x] Slice 9 c2 #2: when no model has ratios, the phone kinds card has no "not split" note, because
  `web/src/CapCostSection.tsx:413-415` returns null before the note.
- [x] Slice 9 c3 #5, #6: `KindsBlock` writes one sentence for all models (`:315`), and `ratioGroups` is keyed on
  formatted strings (`:452-464`).
- [x] Slice 9 c3 #1, #2, #7: `kindsSentence`'s second amount lacks the "times as much" phrasing
  (`web/src/capCostFormat.ts:107-115`), the EN and DE wording of `kindsMultipleOf` (`web/src/strings.ts:165,535`),
  and the rounding in `ratioAmount` (`capCostFormat.ts:68-79`).
- [x] Slice 9 c3 #3: `costPercentText` uses "." in German (`web/src/usageFormat.ts:72-74`). Format by locale.
- [x] Slice 9 c3 #4: the cap-points bar width can go negative (`web/src/AgentKindCost.tsx:18-20`). Clamp it at 0.
- [x] Slice 9 #5 + Slice 2 pr-35 c2 #1: `palettesWithDefaults` bakes the example palettes into the stored config
  (`src/config.ts:332-337`), and the fallback palette is the static example file (`web/src/theme.ts:38-44`).
- [x] Slice 28 #1: the hint shows when any series has no name (`web/src/TokenChart.tsx:278`). Show it only while no
  environment is named, as Slice 28's rule says.
- [x] Slice 28 #3: the `||` in `web/src/usageView.tsx:43-45`.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New tests: a range across the last-Sunday-of-October change; a
  `record_at` ten years out returns at once; residual sums; a German percent with a comma; a negative bar clamped at 0.
- `npm run test:e2e`: the usage page with no ratios shows the "not split" note.

#### Changed while building

- The `touches` list widened: `web/src/TaskCost.tsx`, `web/src/usageApi.ts`, `web/src/usageQuery.ts`, `src/api/usageDto.ts`, `e2e/usage.spec.ts`, `test/capCostRoute.test.ts`, `web/src/chartGeometry.ts`, `src/api/router.ts` (palette line only), `test/usageTools.test.ts`, `web/src/UsagePage.tsx`, `web/src/CapTiles.tsx`, `e2e/usageFixture.ts`.
- Designs: the page sends `time_zone`; one offset rule, `offsetForZone`, serves the Worker and the page; buckets are walked in real time (`bucketsBetween` in `src/domain/usage.ts`) and the Worker sends each bucket as `{key, start, end}`; the page draws exactly that list, and `xOfMoment` is the one position rule; the repeated fall-back hour is keyed `#2` and labelled "(2nd)"; palette defaults are laid under at read (`pageConfigOf`) and only set colours are stored; `placeInWindows` keeps main's end order.
- API change: `GET /api/usage` `buckets` is now a list of objects `{key, start, end}`, not a list of keys.

#### From review

- Applied: every finding of `reviews/pr-138-high.md` except two (the two left out are listed next); 3 and 8 came by the bucket design and the echoed `time_zone` above.
- Skipped #6 (`reviews/pr-138-high.md`): "seriesName changed || to ??, so an empty-string label or name no longer falls back to the placeholder" - the slice item itself asked for `??` in `web/src/usageView.tsx`; an empty label is not a value the Worker sends.
- Skipped #7 (`reviews/pr-138-high.md`): "sessionWindowsFrom is skipped when fitted.fit === null, safe only because placeChatGrowth is the sole consumer" - low; the null-fit skip is correct today and covered by the existing test.
- Applied #5 as a test: the cap line and the use already share the one clamped `from`; readings are read only as far back as `keepDays`, and a test (`a window older than the longest range`) pins that they agree.
- Skipped #6 (`reviews/pr-138-medium.md`): "clampedStart silently shortens range for a cap window older than 30 days; fit/chart and rangeDeltas/cap tiles can cover different spans with no indication" - low; the cap tiles and the chart use the same clamped `from`, and the fix-1 test in `test/usageTools.test.ts` shows they agree.
- Skipped #8 (`reviews/pr-138-medium.md`): "zoneOffsetAt/bucketKey allocate Date and ISO string twice per delta even when offset is a fixed number" - low; two short string builds per delta, bounded by the range, no failure. (The second `localKey` call is gone anyway: buckets now come from one real-time walk.)
- Reopened #1, #2, #3, #4 and #7 of `reviews/pr-138-medium.md` as one design: buckets are walked in real time (`bucketsBetween`, `{key, startMs, endMs}`, repeated keys get `#2`), and every position and range test uses `xOfMoment` / milliseconds. #5: `placeInWindows` is back in end order, pinned by a test.
- Applied #1 of `reviews/pr-138-check-medium.md` by construction (the Worker's list, not a page rebuild): the Worker sends each bucket as `{key, start, end}` (UTC ISO, the `bucketsBetween` list) and the page uses exactly that list; `chartBuckets` only adds labels.
- Skipped #2 (`reviews/pr-138-check-medium.md`): "hourBuckets steps fixed 3,600,000 ms; 30-minute offset change (Lord_Howe) misaligns later buckets" - buckets are one real hour each, which is the slice bucket rule; a 30-minute zone shows half-hour local labels, which is that zone's clock.
- Skipped #3 (`reviews/pr-138-check-medium.md`): "public time_zone spellings defeat the 32-entry formatter cache; two constructions per request" - low; the cache is capped at 32 entries and each miss is one formatter build, no failure.
- `reviews/pr-138-medium.md`: the rest (1 to 5 and 7) were applied by the one bucket design above.
- `reviews/pr-138-check-2-medium.md` (second check pass, converged, 4 low findings, none fixed, all four on the follow-up list below): #1 hourBuckets 3,600,000 ms steps in a 30-minute-shift zone (Lord_Howe); #2 a repeated day key `2026-10-25#2` is read as an hour by key length 10; #3 caller-controlled `time_zone` builds a formatter past the 32-entry cache; #4 `clampedStart` compares ISO strings lexicographically.

#### Open items (follow-up list)

- The four low findings of `reviews/pr-138-check-2-medium.md` above have no slice yet; they need one planned.

#### For CLAUDE.md (lifted 2026-11-18)

- The usage buckets are built once, in real time, by `bucketsBetween` in `src/domain/usage.ts`; the page draws the Worker's `{key, start, end}` list as sent and never rebuilds it, and positions come from `xOfMoment`. Every surface asks one offset rule, `offsetForZone`, for the zone's offset at each moment (Slice 35: docs/plan/slices/35-usage-page-fixes.md).

#### Not yet verified

- On a phone or desktop in a zone with daylight saving, the Usage page's bars, reset markers and labels line up across a clock change (next change: late March).
- The German strings `kindsSecondFraction`, `kindsSecondMultiple`, `multipleOther` and `hourAgain` need the owner's native read.
