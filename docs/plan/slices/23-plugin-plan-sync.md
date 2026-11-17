### Slice 23 — Plan documents sync, an optional plugin part

*Built (wave 2026-11-17), PR #103, not merged.*

*Planned and accepted with Slice 20 (owner, 2026-11-17; decisions in
[Slice 20](20-plugin-connect.md)). Starts after Slice 21.* Moves `sync-docs.mjs` and `sync.md` from the owner's
config repo (`skills/report-progress/`) into `plugin/scripts/`, for repos that keep their plan in this layout:
`plan.md` with a `## Status` table, one file per slice in `docs/plan/slices/`, open checks in
`docs/plan/unverified.md`. Repos without it skip this part.

**Touches:** `plugin/scripts/**`, `plugin/skills/agent-board/SKILL.md`, `docs/clients.md`, `docs/setup/plan-sync.md` (new), `docs/plan/slices/23-plugin-plan-sync.md`

**Migrations:** none

#### Work

- [x] **Move the sync** with its tests and fixtures. It reads from `origin/main` as now; the parked-slices file
  becomes an optional `--parked <file>` with no tie to any runner. Verify: the moved tests pass here.
- [x] **A park reason that waits on a session is not the person's.** Every `parked:` row becomes a
  `waiting_for_me` card today; only "waits for slice N" is exempt. A config repo slice parked as "waits for an
  interactive session" showed as "Waiting on you" for two days. A reason that waits for an interactive session, a
  deploy, another repo's slice or a merge is shown as a blocked slice, not a waiting card. Verify: those four
  reasons give no `waiting_for_me` item; "waits for the user" and "the owner's go" still do.
- [x] **Steps only the person can do reach the board.** An `unverified.md` line starting `**You:**` becomes a
  `waiting_for_me` card (exists today); the skill tells agents to write every such step that way, with its direct
  link, in the same turn they name it. Verify: a test turns a `**You:**` line into a card; the skill says it.
- [x] **Guide.** `docs/setup/plan-sync.md` for Claude: the layout it expects, how to run it (after a merge, by a
  hook or by hand), and how to tell whether a repo qualifies.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.

*Changed while building:* `sync-docs.mjs`, its test and `fixtures/repo-a` now live in `plugin/scripts/` and
send through the plugin's own `report-progress.mjs`. Guide: `docs/setup/plan-sync.md`; sections added to
`plugin/skills/agent-board/SKILL.md` and `docs/clients.md`. The park rule: a reason led by "waits for" / "waiting
on/for" / "behind" plus an interactive session, deploy, merge, CI, PR or another slice gives a blocked slice and
no waiting card; a reason naming the user, owner or "you" keeps the card; "needs ..." keeps the card. From
review: a failed read of `unverified.md` aborts the sync; empty titles are skipped with a notice; File-cell
links are confined to the root; git runs with quotepath off; `--root` takes the project slug from the root
folder; the script sets `process.exitCode` instead of calling `exit`. The plugin installs no hook for the sync:
run it after a merge by hand or from the person's own hook.

#### From review

Findings read: `reviews/pr-103-high.md` 9/9, `reviews/pr-103-medium.md` 10/10, `reviews/pr-103-check-medium.md`
7/7, `reviews/pr-103-check-2-medium.md` 2/2. Applied: high 1 2 3 5 7 8; medium 1 2 4 8; check 1 3. Check 2
converged; its two findings are follow-ups (below). Reasons for the high and medium skips were not in the brief;
where a finding repeats another, that is said.

- Skipped #4 (`reviews/pr-103-high.md`): "Owner steps are emitted for every `### Slice N` block even when the slice has no open row" - same as check #7, follow-up.
- Skipped #6 (`reviews/pr-103-high.md`): "gitSource.read spawns two git processes per file" - same as check #2, follow-up.
- Skipped #9 (`reviews/pr-103-high.md`): "In --dry-run an overflow (over 200 items or 1000 with parts) prints `[]` after the cap message" - the truncation half was fixed with medium #4 (exitCode); the printed `[]` on overflow was not changed.
- Skipped #3 (`reviews/pr-103-medium.md`): "gitSource spawns ls-tree plus show per file" - same as check #2, follow-up.
- Skipped #5 (`reviews/pr-103-medium.md`): "prints created=undefined when reply has no counts" - low, follow-up.
- Skipped #6 (`reviews/pr-103-medium.md`): "variants silently become checks, no notice" - the slice names that exact marker; high #3 tightened it on purpose.
- Skipped #7 (`reviews/pr-103-medium.md`): "owner items get a card under a slice with no open/built row" - same as check #7, follow-up.
- Skipped #9 (`reviews/pr-103-medium.md`): "including prose; spurious card" - same as check #4, existing behaviour.
- Skipped #10 (`reviews/pr-103-medium.md`): "no verification of the real git source path (--repo, origin/main)" - covered by the *Not yet verified* line below.
- Skipped #1 (`reviews/pr-103-check-2-medium.md`): "exempt only when the whole reason is a work wait (clause ends at the target), else keep the card" - follow-up: the exemption is still a deny-list of person words.
- Skipped #2 (`reviews/pr-103-check-2-medium.md`): "readSliceTexts matches by first dash segment of the name, not unique" - follow-up: prefer the File link, skip on several matches.
- Skipped #2 (`reviews/pr-103-check-medium.md`): "gitSource.read spawns two git processes per file (ls-tree then show) with 10 s timeouts and no overall deadline" - low, not asked for in this pass; follow-up.
- Skipped #4 (`reviews/pr-103-check-medium.md`): "anywhere in the status cell and PARK_NOTE matches any line" - existing behaviour, outside this slice's change; follow-up.
- Skipped #5 (`reviews/pr-103-check-medium.md`): "Wait leads are narrow" - the slice's own words are "waits for"; narrow leads keep the card by default; follow-up.
- Skipped #6 (`reviews/pr-103-check-medium.md`): "The park-reason rule is duplicated in SKILL.md, docs/setup/plan-sync.md and sync-docs.mjs with no test holding them equal" - follow-up: add an equality test.
- Skipped #7 (`reviews/pr-103-check-medium.md`): "for a slice with no open row still become standalone waiting_for_me cards" - follow-up, low.

#### For CLAUDE.md

- The park-reason rule (which `parked:` reasons give a blocked slice and no waiting card) lives only in
  `waitsOnlyOnWork` in `plugin/scripts/sync-docs.mjs`; `plugin/skills/agent-board/SKILL.md` describes it in words,
  so change the function and the words together (Slice 23: docs/plan/slices/23-plugin-plan-sync.md).

#### Not yet verified

- A real sync against a live board from a qualifying repo with the plugin's script (`plugin/scripts/sync-docs.mjs`, git mode from `origin/main`).
