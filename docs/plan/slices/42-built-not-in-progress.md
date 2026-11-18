### Slice 42 — A built slice whose checks are untried shows as built, not in progress

*Planned 2026-11-18. The owner, looking at the board: "why do I still have so many in progress work from you? I think
you've already implemented most of the slices! why are they still open?"* No mock: the owner asked only that built work
stop looking unfinished; visual values come from the existing pill and section styles in `docs/design/`.

**Touches:** `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`, `src/domain/boardGroups.ts`,
`test/boardGroups.test.ts`, `test/syncSnapshot.test.ts`, `web/src/strings.ts`, `web/src/planningText.ts`, the board
component that draws the planned list (`web/src/`), `e2e/board.spec.ts`, `docs/plan/slices/42-built-not-in-progress.md`

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
- `SliceState` gains `Built`; nothing new is stored (the state is derived at read).

#### Work

- [ ] Ground first: does marking a slice `done` close or orphan its open check children anywhere (stale sweep
  `EXPIRED_ROWS`, `sync_snapshot` closing, `groupBoard`'s loose checks at `:178-179`)? Fix what does, with a test.
- [ ] `sync-docs.mjs`: built rows and `builtWithChecks` rows go out as `done`; update the comment at `:167-171`.
- [ ] `boardGroups.ts`: the `built` list, `SliceState.Built`, the summary count; tests in `test/boardGroups.test.ts`.
- [ ] Page: the "Built" pill and section from the existing pill and section styles; strings in `web/src/strings.ts`.
- [ ] e2e: a built slice with two checks shows under Built with "Built" and "2 checks not tried on a device"; the header
  does not count it as planned.

#### Verification

- [ ] After the release and one `sync-docs` run, the board's agent-progress-board block shows Slices 2 to 27 under
  Built, none with "In progress", and the header's planned count equals the open rows of `plan.md`.
