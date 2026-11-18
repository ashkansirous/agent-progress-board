### Slice 32 — Open questions are counted and kept right; `ask_human` can set `needs_you`

*In progress (wave 2026-11-18), draft PR.*

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 2.

**Touches:** `src/api/board.ts`, `src/application/board.ts`, `src/domain/upsert.ts`, `src/domain/steps.ts`,
`src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/mcp/instructions.ts`, `plugin/skills/agent-board/SKILL.md`,
`plugin/.claude-plugin/plugin.json`, `docs/setup/connect.md`, `test/board.test.ts`, `test/needsYou.test.ts`,
`test/mcp.test.ts`, `test/upsert.test.ts`, `test/steps.test.ts`, `test/mcpInstructions.test.ts`,
`test/pluginRules.test.ts`, `docs/plan/slices/32-questions-and-rules.md`

**Migrations:** none

#### Why

The mediums of Slices 13 and 14 are about questions. An in-progress item with an open question drops out of
`working_count`. A check that holds a question is counted as working and shows in the phone lists. `askOnItem`
accepts part and doc-synced items, and its blank `why` overwrites an open question. `ask_human` cannot set
`needs_you` on its own waiting item (Slice 27, *Changed while building*). The text parts of Slices 18, 22 and 28 go
here too, because this slice owns `instructions.ts`, `SKILL.md` and `plugin.json`. Slice 18 #2 is done:
`src/mcp/instructions.ts:23` now says to repeat the same `needs_you` text.

#### Decisions

- The question-clearing rule stays only in `answersQuestion` (`src/domain/upsert.ts`). The rules text stays one
  constant (`SERVER_INSTRUCTIONS`), mirrored in `SKILL.md` and held equal by `test/pluginRules.test.ts`: change both
  together (root `CLAUDE.md`).
- An open question on an item that is not done counts the item in `working_count` if `isWorkingNow` says so. The
  question doesn't hide it. Decided by the planning session; it is what Slice 13 check pass 2 #1 asks for.

#### Work

- [ ] Slice 13 #1 (medium): `working` is `!hasOpenQuestion && isWorkingNow` (`src/api/board.ts:155`), so
  `working_count` (`:192`) drops an in-progress item that has an open question. Count it.
- [ ] Slice 14 c3 #2 (medium): question-holding checks are appended to the items (`src/api/board.ts:~187-192`) and
  counted in `working_count` and the phone lists. Don't count checks as working.
- [ ] Slice 14 check #6: a check with an open question gets `parent_slice: null`, because `SLICE_CHILD_TYPES`
  (`src/api/board.ts:91`) leaves Check out.
- [ ] Slice 13 #5: `hasOpenQuestion` is computed twice per item (`src/api/board.ts:116`, `:155`).
- [ ] Slice 13 #3 (medium): `askOnItem` (`src/application/board.ts:93-99`) accepts part and doc-synced items, and a
  blank `why` (which falls back to the title at `:96`) overwrites a stored question and resets `needs_you_at`.
  Refuse part and doc-synced keys, and keep an open question unless the new text differs.
- [ ] Slice 13 #2: `needs_you` with status `done` stores the question on a done item (`src/domain/upsert.ts:104-105`,
  `withQuestion` to `withAsked`). It is hidden when read, but still stored. Don't store it.
- [ ] Slice 27: `ask_human` cannot set `needs_you`. `askHumanShape` (`src/mcp/schemas.ts:140-151`) has no
  `needs_you` and no `links`. On a `waiting_for_me` key, `src/application/board.ts:76-85` only reports progress, with
  the question as the title. Add `needs_you` and `links` to the shape, set them on the waiting item, update the tool
  description (`src/mcp/tools.ts:113`), and name `ask_human` in `SERVER_INSTRUCTIONS`, mirrored in `SKILL.md`.
- [ ] Slice 10 high #5 + med #5: `normalizeSteps` runs twice (`src/domain/upsert.ts:64`, `:142`).
- [ ] Slice 10 check-2 #2, #3: the step label and note lengths are checked before trimming but stored trimmed
  (`src/domain/steps.ts:17,21` vs `:34`), and `blankToNull` returns the untrimmed text (`:38-40`).
- [ ] Slice 10 check-med #9: `listOpen` uses a `Partial` cast (`src/application/board.ts:272-277`, `withoutExpiry`).
- [ ] Slice 1: `get_item` and `list_open` have no size limit and no "truncated" marker (`src/mcp/tools.ts:126-136`,
  `src/application/board.ts:258`). There is also a duplicate find before `reportProgress` (`:80`).
- [ ] Slice 18 #3: the helper rule doesn't say that steps replace the whole list (`src/mcp/instructions.ts:16`).
- [ ] Slice 18 #4: a quiet chat's card expires at 15 minutes, and nothing tells the chat (`instructions.ts:16-30`).
  Add one sentence: a chat that is waiting on the person sends no heartbeat; its card turns stale, and that is
  expected.
- [ ] Slice 22 c2 #3: the consent text (`plugin/.claude-plugin/plugin.json:24-28`, `docs/setup/connect.md:61`,
  `plugin/skills/agent-board/SKILL.md:52`) doesn't name the plan name or the reset times that the cap reading sends.
- [ ] Slice 28 #4: the `environment` option description (`plugin.json:33`) is long. Shorten it to one sentence.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New tests: `test/board.test.ts` (working count with an open
  question; checks not counted as working; check `parent_slice`), `test/needsYou.test.ts` (`askOnItem` refusals,
  blank `why`, `ask_human` sets `needs_you`), `test/steps.test.ts` (trimmed lengths), and `test/pluginRules.test.ts`
  still green.
- On the live board after the release, with the owner's claude.ai chat: `ask_human` with `needs_you` shows the
  question under "Needs you".
