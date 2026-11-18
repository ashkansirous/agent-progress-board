### Slice 33 — Doc sync never retypes live work, and checks and parts count right

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 3, after Slice 32 (both edit
`src/mcp/schemas.ts` and `src/application/board.ts`).

**Touches:** `src/domain/docSync.ts`, `src/domain/checks.ts`, `src/domain/boardGroups.ts`, `src/domain/parts.ts`,
`src/application/board.ts`, `src/mcp/schemas.ts`, `test/syncSnapshot.test.ts`, `test/docSync.test.ts`,
`test/checks.test.ts`, `test/boardGroups.test.ts`, `test/parts.test.ts`, `test/partsTools.test.ts`,
`docs/plan/slices/33-sync-and-checks-rules.md`, `src/domain/item.ts`, `web/src/strings.ts`, `test/partsWeb.test.ts`,
`plugin/scripts/sync-docs.mjs`, `docs/clients.md`, `web/src/ChecksView.tsx`, `web/src/PlannedSection.tsx`,
`web/src/partsText.ts`, `web/src/planningText.ts`, `src/infrastructure/d1Repository.ts`

*Built 2026-11-18 (wave 2026-11-18, merged as PR #147, 088eb84), not yet verified on the live board.*

**Migrations:** none

#### Why

These are the domain-rule mediums of Slice 14 (*Follow-ups*) and the open follow-ups of Slices 4 and 11:
- a doc slice retypes a live bug, problem, part or check that shares its key;
- a doc-synced bug or problem is kept forever (`isKeptChild`);
- checks of done or never-synced slices count as loose and inflate `checks_not_tried`;
- a blocked part reads as Next or Later.

#### Decisions

- Validation stays one function, `itemProblem` (`src/domain/checks.ts`). Grouping stays `groupBoard`. The part rule
  stays in `src/domain/parts.ts` (root `CLAUDE.md`).
- Sync never changes the `type` of a stored item that is not doc-synced. It skips that item and returns it in
  `skipped`, the same way an invalid item is skipped. Decided by the planning session; this is the fix Slice 14
  check pass 3 #5 points to.

#### Work

- [x] Slice 14 c3 #5 (medium): `planItem` (`src/domain/docSync.ts:200`) overwrites the stored type on every sync.
  Skip a live non-doc item that shares the key. Also Slice 14 pass-2 #1: the schema text (`src/mcp/schemas.ts:175`)
  says `type` is used only when the key is new; make the text and the code agree.
- [x] Slice 14 c3 #7 (medium): `isKeptChild` (`docSync.ts:~254-259`) keeps the bug and problem children of a slice
  with no parts forever. Close the doc-synced ones the document dropped.
- [x] Slice 14 c3 #4 (medium): checks of done or never-synced slices count as loose
  (`src/domain/boardGroups.ts:~165`) and inflate `checks_not_tried`. Also Slice 14 check #5: a filtered listing
  counts a check whose slice is missing as loose.
- [x] Slice 14 c3 #6: `checksBySlice` (`src/domain/checks.ts:75-84`) counts stale and blocked checks.
- [x] Slice 14 pass-2 #4: `topLevelProblem` checks a check's parent against a sibling that may itself be skipped.
- [x] Slice 14 pass-2 #5 (already covered by `screenSnapshot`, which screens the expanded groups; proven by a test): `syncSnapshot` validates only `input.items`, not the expanded set
  (`src/application/board.ts:127`).
- [x] Slice 11 check-med #1 (`PartState.Blocked`, `PartNowKind.Blocked`, "(blocked)" suffix): `partStateOf` (`src/domain/parts.ts:~100`) has no blocked state, so a blocked part
  reads as Next or Later.
- [x] Slice 11 #2: a `parent_key` cycle, a parent that is not a slice, or a key-prefix mismatch is not refused
  (`src/domain/checks.ts:38-43`, through `assertItemFits`, `src/application/board.ts:53-60`).
- [x] Slice 11 #3: a part key built from a 200-character slice key goes over `MAX_KEY` (`src/mcp/schemas.ts:10`).
  Refuse such a slice key with a clear message.
- [x] Slice 11 #4: the 1000 expanded-items bound (`src/domain/docSync.ts:13`) is not in the schema text. Write it
  there.
- [x] Slice 11 med #5: sync can't clear a stored `parent_key` (`docSync.ts:206`).
- [x] Slice 14 check-4 #3: `firstPendingKey` (`src/domain/parts.ts`) is used only by a test
  (`test/parts.test.ts:93`). Remove both.
- [x] Slice 4 #3: a closed key returned as done is not a docs change (`docSync.ts:173-186`). Trace it and fix it, or
  write down why it is right.
- [x] Slice 4 #4: the first sync replaces a live `why`, `parent` or `links` when the snapshot leaves them out
  (`docSync.ts:~203-206`). Keep the live values when a field is absent.
- [x] Slice 4 med #6: `docFieldsDiffer` doesn't compare `done_at`. Slice 4 med #9: the snapshot fields are declared a
  second time in `src/mcp/schemas.ts:172`; build them from one shape.
- [x] Slice 27 chk #6 (stored on insert only, in `SYNC_UPSERT`), carried from Slice 31 (Slice 31 could not build it):
  the rest of a clipped title goes to `details_md`, so it reaches the card. Add `details_md` to `snapshotItem` in
  `src/mcp/schemas.ts` and set it in `newRow` in `src/domain/docSync.ts`
  ([Slice 31](31-sync-and-waiting-text.md), *Follow-ups*).
- [ ] No change: Slice 14 pass-2 #6 (the loose-checks list has no slice number; by design).

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. Each medium gets a test in `test/syncSnapshot.test.ts` or
  `test/boardGroups.test.ts` that fails on `origin/main`: a live bug sharing a slice key keeps its type; a dropped
  doc bug closes; a done slice's checks are not loose.
- After the release: the owner's next plan sync shows the same `checks_not_tried` count as the slice files say.

#### Changed while building

- A cloud session (commit ba77309, run `cse_012UYzYV1abAdbrAzdh2C2TP`) built most of it and printed no CLOUD DONE
  line, so it counts as partial; the rest was finished locally: the blocked part state, `details_md` on insert and
  while the stored value is null, and item 6 (proven by a test, no code change).
- Sync skips a live item retyped under the same key (`typeConflict` inside `itemProblem`, live items only). A
  doc-synced bug or problem the document dropped closes. A `why`, `parent` or `links` omitted from the snapshot keeps its
  stored value on every sync, not only the first.
- Check rules: `isShownCheck` (not done) decides what is shown, `isCountedCheck` (open, in_progress) what counts.
  `checksBySlice`, `isBuilt` and `OPEN_CHECK_OF` (`src/infrastructure/d1Repository.ts`) share `isCountedCheck`. Stale and
  blocked checks show muted with a state word and do not count; a done slice with only blocked or stale checks is not
  Built.
- Cycles of any length are refused (bounded walk, depth 20). An unchanged legacy relation never blocks a report. A bug or
  problem under a non-slice parent is accepted, as on main.
- Blocked part state (`PartState.Blocked`, derived at read), muted on both pages; "(blocked)" in English and German.
- `plugin/scripts/sync-docs.mjs` sends `details_md` with the rest of a clipped title, clipped on a code-point boundary.
- Touches widened to the web files, `partsText.ts`, `planningText.ts` and `d1Repository.ts` listed above.
- Checks: lint, typecheck, 665 vitest, 342 plugin and 312 e2e tests (4 skipped) green (`run-checks`, after the last fix).

#### From review

Files read in full: `reviews/pr-147-high.md` (10 findings), `reviews/pr-147-medium.md` (8), `reviews/pr-147-check-medium.md` (8),
`reviews/pr-147-check-2-medium.md` (5 follow-ups). Findings not listed as skipped below were applied. The five findings
of `pr-147-check-2-medium.md` are open follow-ups, not fixed here: a stale `why` stays after a slice reopens because the
plugin omits it (#1); a legacy relation loop stays unreported and `loadParents` does up to 20 sequential reads (#2);
the loose-checks card can read "0 checks not tried" with only stale or blocked loose checks (#3); `closeTargets` closes
a live-edited bug under a slice that sent no parts or checks list (#4); `partNow` shows a blocked part ahead of the next
pending one (#5).

- Skipped #3 (`reviews/pr-147-high.md`): "The loose-check fix does not cover never-synced slices or a filtered listing." - A check whose slice is stored nowhere has no slice to show it under, so hiding it would drop loaded data; the board read is never filtered by slice (a not-done check always loads its slice), so the only loose checks are those of a missing slice, and the existing test pins that.
- Skipped #6 (`reviews/pr-147-medium.md`): "topLevelReasons re-copies the kept map and reruns topLevelProblem over all groups per pass (up to N+1 passes)." - The schema caps a snapshot at 1000 items, so the passes are bounded; a worklist by parent is a follow-up, not a defect.
- Skipped #2 (`reviews/pr-147-check-medium.md`): "topLevelReasons re-screens all items each pass, O(n^2) with ancestor walks on a skip chain; compute skipped set once." - Input is capped at 1000 items, so the cost is bounded; a follow-up, not a defect.
- Skipped #3 (`reviews/pr-147-check-medium.md`): "details_md is write-once (stored ?? snap), so editing a long title later leaves stale overflow text under the new title." - Write-once is the Decision of the earlier fix: a set details_md is never overwritten.
- Skipped #4 (`reviews/pr-147-check-medium.md`): "titleFields cuts the rest at 20000 chars with no ellipsis, though the card claims to hold the whole text." - 20000 is the schema cap for details_md; nothing longer can be stored.
- Skipped #6 (`reviews/pr-147-check-medium.md`): "SLICE_CHILD_TYPES here (Part, Check) and in src/api/board.ts (Part, Check, Bug, Problem) share a name but mean different rules; rename one." - Naming only; no behaviour changes.
- Skipped #7 (`reviews/pr-147-check-medium.md`): "assertItemFits returns early for existing rows, so legacy parts with bad keys keep accepting reports while a snapshot skips them; document it." - Doc only.
- Skipped #8 (`reviews/pr-147-check-medium.md`): "part-key length rule covers only a snapshot slice's own parts; a long-keyed slice sent without a parts list but with stored parts is unchecked" - Rare; a later report that carries the parts list catches it.

#### For CLAUDE.md (lifted 2026-11-18)

- What a check shows and counts is `isShownCheck` / `isCountedCheck` in `src/domain/checks.ts`; `OPEN_CHECK_OF` in
  `src/infrastructure/d1Repository.ts` is built from the counted statuses; never a third copy. Retyping a live key is
  refused only in `itemProblem` (Slice 33: docs/plan/slices/33-sync-and-checks-rules.md).

#### Not yet verified

- After the release, the owner's next plan sync shows the same `checks_not_tried` count as the slice files, and a stale or blocked check shows muted under its slice.
