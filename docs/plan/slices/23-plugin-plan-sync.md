### Slice 23 — Plan documents sync, an optional plugin part

*Planned and accepted with Slice 20 (owner, 2026-11-17; decisions in
[Slice 20](20-plugin-connect.md)). Starts after Slice 21.* Moves `sync-docs.mjs` and `sync.md` from the owner's
config repo (`skills/report-progress/`) into `plugin/scripts/`, for repos that keep their plan in this layout:
`plan.md` with a `## Status` table, one file per slice in `docs/plan/slices/`, open checks in
`docs/plan/unverified.md`. Repos without it skip this part.

**Touches:** `plugin/scripts/**`, `plugin/skills/agent-board/SKILL.md`, `docs/clients.md`, `docs/setup/plan-sync.md` (new), `docs/plan/slices/23-plugin-plan-sync.md`

**Migrations:** none

#### Work

- [ ] **Move the sync** with its tests and fixtures. It reads from `origin/main` as now; the parked-slices file
  becomes an optional `--parked <file>` with no tie to any runner. Verify: the moved tests pass here.
- [ ] **A park reason that waits on a session is not the person's.** Every `parked:` row becomes a
  `waiting_for_me` card today; only "waits for slice N" is exempt. A config repo slice parked as "waits for an
  interactive session" showed as "Waiting on you" for two days. A reason that waits for an interactive session, a
  deploy, another repo's slice or a merge is shown as a blocked slice, not a waiting card. Verify: those four
  reasons give no `waiting_for_me` item; "waits for the user" and "the owner's go" still do.
- [ ] **Steps only the person can do reach the board.** An `unverified.md` line starting `**You:**` becomes a
  `waiting_for_me` card (exists today); the skill tells agents to write every such step that way, with its direct
  link, in the same turn they name it. Verify: a test turns a `**You:**` line into a card; the skill says it.
- [ ] **Guide.** `docs/setup/plan-sync.md` for Claude: the layout it expects, how to run it (after a merge, by a
  hook or by hand), and how to tell whether a repo qualifies.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.
