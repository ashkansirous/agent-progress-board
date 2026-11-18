### Slice 33 — Doc sync never retypes live work, and checks and parts count right

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 3, after Slice 32 (both edit
`src/mcp/schemas.ts` and `src/application/board.ts`).

**Touches:** `src/domain/docSync.ts`, `src/domain/checks.ts`, `src/domain/boardGroups.ts`, `src/domain/parts.ts`,
`src/application/board.ts`, `src/mcp/schemas.ts`, `test/syncSnapshot.test.ts`, `test/docSync.test.ts`,
`test/checks.test.ts`, `test/boardGroups.test.ts`, `test/parts.test.ts`, `test/partsTools.test.ts`,
`docs/plan/slices/33-sync-and-checks-rules.md`, `src/domain/item.ts`, `web/src/strings.ts`, `test/partsWeb.test.ts`,
`plugin/scripts/sync-docs.mjs`, `docs/clients.md`

*In progress (wave 2026-11-18), draft PR.*

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
- [ ] Slice 14 pass-2 #5: `syncSnapshot` validates only `input.items`, not the expanded set
  (`src/application/board.ts:127`).
- [ ] Slice 11 check-med #1: `partStateOf` (`src/domain/parts.ts:~100`) has no blocked state, so a blocked part
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
- [ ] Slice 27 chk #6, carried from Slice 31 (Slice 31 could not build it):
  the rest of a clipped title goes to `details_md`, so it reaches the card. Add `details_md` to `snapshotItem` in
  `src/mcp/schemas.ts` and set it in `newRow` in `src/domain/docSync.ts`
  ([Slice 31](31-sync-and-waiting-text.md), *Follow-ups*).
- [ ] No change: Slice 14 pass-2 #6 (the loose-checks list has no slice number; by design).

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. Each medium gets a test in `test/syncSnapshot.test.ts` or
  `test/boardGroups.test.ts` that fails on `origin/main`: a live bug sharing a slice key keeps its type; a dropped
  doc bug closes; a done slice's checks are not loose.
- After the release: the owner's next plan sync shows the same `checks_not_tried` count as the slice files say.
