### Slice 59 — Step and sync rule follow-ups from Slice 51's reviews (bug)

*Planned 2026-11-26 by plan-cleanup, moved out of Slice 51.*

**Product:** agent-progress-board.

*Check 2026-11-26 (plan-cleanup-check): keep open, not started. No commit mentions Slice 59 beyond planning, and `steps.ts` and `docSync.ts` have no commits since Slice 51/55. Item 1 re-read: `ownerBlockedSince` (steps.ts:631) still uses `started_at`. Item 2 re-read: `stepProgress` (steps.ts:641) still returns null for empty steps even with `openChecks`. Items 3-8 not re-proved line by line; no change landed in their files. Item 9: user-says finds nothing the user said on it. No outside waits in this slice.*

**Touches:** `src/domain/steps.ts`, `src/domain/docSync.ts`, `src/infrastructure/d1Repository.ts`, `plugin/scripts/hooks/`, `src/api/board.ts`, `test/`.

## Why
Slice 51 was built and is live; its review rounds left follow-ups that are real but not its own work. Each is quoted from Slice 51's file (From review / G).

## Work
- [ ] 1. `ownerBlockedSince` uses the step's old `started_at`, so the card shows "waiting on you" since the step began, not since it was blocked. Stamp when the step entered blocked. (Still true on origin/main.)
- [ ] 2. `stepProgress` returns null for empty steps even with open checks: a slice with checks only shows no bar or count. (Still true: `if (!steps || steps.length === 0) return null`.)
- [ ] 3. `hookStep`/`hookLevel`: a sent step with an id and a renamed label never matches a stored id-less step; stored non-agent children are lost on the next hook report.
- [ ] 4. `statusAfterSync` keep-done decision uses the snapshot's checks, `OPEN_CHECK_OF` counts every check row under the parent; add an equality test.
- [ ] 5. `orderedTimes`: confirm every `normalizeSteps` caller passes `now`, or test the null path (end becomes `start.at`, stamped, 0 s step).
- [ ] 6. Agent rows are identified only by the `agent-` id prefix and `source: "hook"` is trusted; a session step with id `agent-plumbing` is dropped or moved by a hook report, and any client can trigger the hook merge.
- [ ] 7. `isStoredStep` rejects an unknown `waits_on` or state, so a rollback or bad value makes the whole step list parse as null; a blocked step with an empty note refuses the whole report instead of defaulting the note.
- [ ] 8. An `apply_batch` upsert of a done slice sent as in progress with no checks field ignores its stored open checks and reopens it (fits Slice 50's revive rule; decide whether to change).
- [ ] 9. **Doc-sync counts that don't add up** (moved from ClaudeSkills Slice 29 item 13, 2026-11-26; from ClaudeSkills Slice 23 item 11). Quoted: "print-the-damn-book's first sync printed `items=10 created=18` (night 1526, a7102e6d entries 1140, 1155; only in `docs/plan/notes/2026-11-17-1526-feedback-loop.md:78`). Find why. Verify: the created count equals the repo's plan rows new to the board." ClaudeSkills `docs/plan/unverified.md` also says: "doc-sync counts (`items=10 created=18`) moved to the agent-progress-board repo's plan; not built here, so this check is tracked in that repo".

Dropped as already fixed: "`timeFields` sends echoed times with no source" (`goal-reminder.mjs` now skips `stamped` and sends a source only when given).
