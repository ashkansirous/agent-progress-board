### Slice 42 — A built slice whose checks are untried shows as built, not in progress

*Built 2026-11-18 (night 2026-11-18-1602, wave 2, placement local), PR #139, not merged; the live-board check is not yet done.*

*Planned 2026-11-18. The owner, looking at the board: "why do I still have so many in progress work from you? I think
you've already implemented most of the slices! why are they still open?"* No mock: the owner asked only that built work
stop looking unfinished; visual values come from the existing pill and section styles in `docs/design/`.

**Touches:** `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`, `src/domain/boardGroups.ts`,
`test/boardGroups.test.ts`, `test/syncSnapshot.test.ts`, `web/src/strings.ts`, `web/src/planningText.ts`,
`web/src/PlannedSection.tsx`, `web/src/ProjectGroup.tsx`, `web/src/board.css`, `web/src/planning.css`,
`plugin/skills/agent-board/SKILL.md`, `e2e/board.spec.ts`, `e2e/planning.spec.ts`, `src/infrastructure/d1Repository.ts`,
`test/checks.test.ts`, `docs/setup/plan-sync.md`, `test/planningText.test.ts`, `test/projectFold.test.ts`,
`web/src/LooseChecksDrawer.tsx` (comment only),
`docs/plan/slices/42-built-not-in-progress.md`

Line numbers checked at claim (origin/main d28c2d6): `builtWithChecks` is `plugin/scripts/sync-docs.mjs:188`, the built-row
`in_progress` mapping `:326`, `mapStatus` `:99`; `sliceStateOf` `src/domain/boardGroups.ts:134-136`; the planned list is drawn
in `web/src/PlannedSection.tsx`, mounted at `web/src/ProjectGroup.tsx:64-65`; the header count is `web/src/planningText.ts:72`.

**Migrations:** none

#### Why

On 2026-11-18 the board showed "nothing running · 35 planned" and built slices (2 to 27 in the owner's
screenshot) each carrying an "In progress" pill. The cause, read from the code:
- `builtWithChecks` (`plugin/scripts/sync-docs.mjs:167-176`) turns every built slice that still has a block in
  `docs/plan/unverified.md` into a slice item, and `sliceItems` (`:277`) sends it as `in_progress`, as `mapStatus`
  (`:86`) does for a `built` row.
- `groupBoard` puts every slice in `planned` (`src/domain/boardGroups.ts:169-177`) and `sliceStateOf` (`:135-138`) shows
  `in_progress` as "In progress"; the header counts all of them as planned.

So a slice whose code is merged and that waits only for a device check looks like unfinished work.

#### Decisions

- A built slice (a `built` row, or a `slices-done.md` row with an `unverified.md` block) is sent as status `done`
  with its `checks`, never `in_progress`. Its checks stay open items under it.
- `groupBoard` gets a `built` list: a done slice with at least one open check. Its card shows the pill "Built" and
  "N checks not tried on a device", sorted by slice number, in its own section "Built · N" after Planned (folded by
  default like Done work). The header's "N planned" counts only slices still to build; "N checks not tried" is unchanged.
- A done slice with no open check goes to Done as today. The grouping stays one function (root `CLAUDE.md`, `groupBoard`).
- A built row whose slice file still has an unfinished part (an unticked part checkbox) keeps its old `in_progress`
  mapping; only a built row with nothing left but device checks becomes `done` (`statusOfRow` in `sync-docs.mjs`).
- `SliceState` gains `Built`; nothing new is stored (the state is derived at read).

#### Work

- [x] Ground first: does marking a slice `done` close or orphan its open check children anywhere (stale sweep
  `EXPIRED_ROWS`, `sync_snapshot` closing, `groupBoard`'s loose checks at `:178-179`)? Fix what does, with a test.
- [x] `sync-docs.mjs`: built rows and `builtWithChecks` rows go out as `done`; update the comment at `:167-171`.
- [x] `boardGroups.ts`: the `built` list, `SliceState.Built`, the summary count; tests in `test/boardGroups.test.ts`.
- [x] Page: the "Built" pill and section from the existing pill and section styles; strings in `web/src/strings.ts`.
- [x] e2e: a built slice with two checks shows under Built with "Built" and "2 checks not tried on a device"; the header
  does not count it as planned.

#### Verification

- [ ] After the release and one `sync-docs` run, the board's agent-progress-board block shows Slices 2 to 27 under
  Built, none with "In progress", and the header's planned count equals the open rows of `plan.md`.

*Changed while building:* Touches widened to `src/infrastructure/d1Repository.ts` (`BOARD_WHERE` keeps a done slice
with an open check on the board; the probe runs once per row; query-plan test in `test/checks.test.ts`),
`docs/setup/plan-sync.md`, `test/planningText.test.ts`, `test/projectFold.test.ts`. Decision 4 was added in fix 1 (a
built row with an unfinished part keeps `in_progress`). The summary line shows "N built".

*Checks on the final tree:* lint, typecheck, vitest 507, plugin node 341, e2e 265 passed 3 skipped.

*From review:* (read in full: `reviews/pr-139-high.md` 7/7, `reviews/pr-139-medium.md` 7/7,
`reviews/pr-139-check-medium.md` 3/3)
- High: applied #1, #2, #3, #4, #6; #7 in part (the project summary shows "N built"; the fold rule `isQuiet` is
  unchanged, see check #2 below).
- Skipped #5 (`reviews/pr-139-high.md`): "BuiltSection copies DoneSection's fold-toggle markup" - a shared fold toggle is a
  refactor for its own sake.
- Medium: applied #1, #2, #6, #7.
- Skipped #3 (`reviews/pr-139-medium.md`): "statusOfRow decides done vs in_progress from sliceText" - Decision 1: a
  built slice "is sent as status `done`"; only a slice file that shows an unfinished part keeps `in_progress`, and a
  row with no slice text shows none.
- Skipped #4 (`reviews/pr-139-medium.md`): "Built-detection rule exists twice" - low; two small reads of the same status word.
- Skipped #5 (`reviews/pr-139-medium.md`): "BuiltSection duplicates DoneSection's fold toggle" - low; same as high #5.
- Check pass: #3 (`nowLine` reading the parts) was applied on purpose in fix 2 for medium #6.
- Skipped #2 (`reviews/pr-139-check-medium.md`): "isQuiet ignores `summary.built`" - the slice Decision says Built is
  "folded by default like Done work", so a project with only Built work folding is that Decision.
- Follow-up (not fixed): check #1, low, `docs/clients.md` has no list of the `built` grouping and `summary.built`.

#### For CLAUDE.md

- A done slice with at least one open check is Built: `BOARD_WHERE` in `src/infrastructure/d1Repository.ts` keeps it on
  the board, `groupBoard` in `src/domain/boardGroups.ts` derives the `built` list, and nothing about it is stored (Slice 42:
  docs/plan/slices/42-built-not-in-progress.md).

#### Not yet verified

- After the release and one `sync-docs` run, the live board shows built slices under Built, not in progress.
- A device look at the Built section on a phone.
