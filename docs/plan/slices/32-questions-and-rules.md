### Slice 32 — Open questions are counted and kept right; `ask_human` can set `needs_you`

*Built 2026-11-18 (night 2026-11-18-1602, wave 2), PR #137, not merged. Placement cloud: pushed 5a04aa8, run cse_012UYzYTd5irTamTWuS6uerz (partial, no CLOUD DONE line), finished locally. Checks on the final tree: lint, typecheck, vitest 522, plugin 340. Not yet verified on the live board.*

*Changed while building:* Touches widened to `docs/clients.md` (the `ask_human` reference). `list_open` / `get_item` replies are cut at 50,000 characters by `cutReply`, never clipping ids or times; the note names the first dropped key. `ask_human` on an existing non-waiting item passes only the question fields and never writes the question text into `why` (it is stored as `why` only beside `needs_you`; writing it would overwrite the item's goal).

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 2.

**Touches:** `src/api/board.ts`, `src/application/board.ts`, `src/domain/upsert.ts`, `src/domain/steps.ts`,
`src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/mcp/instructions.ts`, `plugin/skills/agent-board/SKILL.md`,
`plugin/.claude-plugin/plugin.json`, `docs/setup/connect.md`, `test/board.test.ts`, `test/needsYou.test.ts`,
`test/mcp.test.ts`, `test/upsert.test.ts`, `test/steps.test.ts`, `test/mcpInstructions.test.ts`,
`test/pluginRules.test.ts`, `docs/clients.md`, `docs/plan/slices/32-questions-and-rules.md`

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

- [x] Slice 13 #1 (medium): `working` is `!hasOpenQuestion && isWorkingNow` (`src/api/board.ts:155`), so
  `working_count` (`:192`) drops an in-progress item that has an open question. Count it.
- [x] Slice 14 c3 #2 (medium): question-holding checks are appended to the items (`src/api/board.ts:~187-192`) and
  counted in `working_count` and the phone lists. Don't count checks as working.
- [x] Slice 14 check #6: a check with an open question gets `parent_slice: null`, because `SLICE_CHILD_TYPES`
  (`src/api/board.ts:91`) leaves Check out.
- [x] Slice 13 #5: `hasOpenQuestion` is computed twice per item (`src/api/board.ts:116`, `:155`).
- [x] Slice 13 #3 (medium): `askOnItem` (`src/application/board.ts:93-99`) accepts part and doc-synced items, and a
  blank `why` (which falls back to the title at `:96`) overwrites a stored question and resets `needs_you_at`.
  Refuse part and doc-synced keys, and keep an open question unless the new text differs.
- [x] Slice 13 #2: `needs_you` with status `done` stores the question on a done item (`src/domain/upsert.ts:104-105`,
  `withQuestion` to `withAsked`). It is hidden when read, but still stored. Don't store it.
- [x] Slice 27: `ask_human` cannot set `needs_you`. `askHumanShape` (`src/mcp/schemas.ts:140-151`) has no
  `needs_you` and no `links`. On a `waiting_for_me` key, `src/application/board.ts:76-85` only reports progress, with
  the question as the title. Add `needs_you` and `links` to the shape, set them on the waiting item, update the tool
  description (`src/mcp/tools.ts:113`), and name `ask_human` in `SERVER_INSTRUCTIONS`, mirrored in `SKILL.md`.
- [x] Slice 10 high #5 + med #5: `normalizeSteps` runs twice (`src/domain/upsert.ts:64`, `:142`).
- [x] Slice 10 check-2 #2, #3: the step label and note lengths are checked before trimming but stored trimmed
  (`src/domain/steps.ts:17,21` vs `:34`), and `blankToNull` returns the untrimmed text (`:38-40`).
- [x] Slice 10 check-med #9: `listOpen` uses a `Partial` cast (`src/application/board.ts:272-277`, `withoutExpiry`).
- [x] Slice 1: `get_item` and `list_open` have no size limit and no "truncated" marker (`src/mcp/tools.ts:126-136`,
  `src/application/board.ts:258`). There is also a duplicate find before `reportProgress` (`:80`).
- [x] Slice 18 #3: the helper rule doesn't say that steps replace the whole list (`src/mcp/instructions.ts:16`).
- [x] Slice 18 #4: a quiet chat's card expires at 15 minutes, and nothing tells the chat (`instructions.ts:16-30`).
  Add one sentence: a chat that is waiting on the person sends no heartbeat; its card turns stale, and that is
  expected.
- [x] Slice 22 c2 #3: the consent text (`plugin/.claude-plugin/plugin.json:24-28`, `docs/setup/connect.md:61`,
  `plugin/skills/agent-board/SKILL.md:52`) doesn't name the plan name or the reset times that the cap reading sends.
- [x] Slice 28 #4: the `environment` option description (`plugin.json:33`) is long. Shorten it to one sentence.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New tests: `test/board.test.ts` (working count with an open
  question; checks not counted as working; check `parent_slice`), `test/needsYou.test.ts` (`askOnItem` refusals,
  blank `why`, `ask_human` sets `needs_you`), `test/steps.test.ts` (trimmed lengths), and `test/pluginRules.test.ts`
  still green.
- On the live board after the release, with the owner's claude.ai chat: `ask_human` with `needs_you` shows the
  question under "Needs you".

#### From review

- Skipped #5 (`reviews/pr-137-high.md`): "calls `repo.loadForSync` (items + events + joins)" - one extra read on a rare ask path, no failure.
- Skipped #10 (`reviews/pr-137-high.md`): "`withoutExpiry` uses `void expiry; void docSync;`" - style only; the destructuring is correct.
- Skipped #2 (`reviews/pr-137-high.md`): "`working` is true for an in-progress item with" - settled by Decision 2 ("An open question on an item that is not done counts the item in `working_count`"); the finding asks for the opposite on the same lines.
- Applied in part #1 (`reviews/pr-137-medium.md`): "ask_human `why` stored only when `needs_you` sent; fallback branch drops it" - `why` is stored as why only beside a `needs_you`; when it is used as the question text it stays out of the item's why field, since writing it there would overwrite the item's own goal text (data loss).
- Skipped #4 (`reviews/pr-137-medium.md`): "list serialized three+ times per call (fitList, takeWithin, success); measure once" - low; the work is bounded by the 50k cap, no failure (the cut is now measured in `cutReply`).
- Skipped #5 (`reviews/pr-137-medium.md`): "withoutExpiry rewritten with `void` lint workaround; scope creep, noisier" - low, style only; same as pr-137-high #10.
- Skipped #1 (`reviews/pr-137-check-medium.md`): "reply size counted in UTF-16 units, not bytes/tokens." - the limit is Claude Code's own character count for a text result, so counting characters matches it.
- Skipped #5 (`reviews/pr-137-check-medium.md`): "markDone uses `existing` read earlier for withQuestion/assertItemFits with" - low; a stale read needs two writes to the same key in the same moment, and each request is one D1 round trip.
- Skipped #7 (`reviews/pr-137-medium.md`): "whitespace-only needs_you with no why re-asserts stored question (kept ?? title), neither cleared nor refused; timing dependent" - low; re-asking the same open question changes nothing the owner sees.
- Skipped #8 (`reviews/pr-137-medium.md`): "environment option text drops the rule that unlabelled usage folds into the busiest named environment (Slice 28)" - Slice 28 #4 says "Shorten it to one sentence".
- Skipped #9 (`reviews/pr-137-medium.md`): "silently drops the question without error" - Slice 13 #2 (this slice's work list) says not to store it; dropping is the wanted behaviour.
- Other findings of `reviews/pr-137-high.md` (#1, #3, #4, #6, #7, #8, #9) and `reviews/pr-137-medium.md` (#2, #3, #6) were applied by the fixers (all 10 and 9 findings read).
- Review file `reviews/pr-137-check-medium.md` (5 findings, all read): numbers 2, 3 and 4 applied; the other two are listed above.
- `reviews/pr-137-check-2-medium.md`: REVIEW INCOMPLETE, no fork ran (narrow brief read directly); it has no findings and is not counted as a review.
- `reviews/pr-137-check-3-medium.md` (second check pass, 8 findings, all read, converged): none applied; all eight go to the follow-up list below. #2 (working vs question) repeats the settled Decision, and #7 repeats `reviews/pr-137-check-medium.md` #9 (Slice 13 #2).

#### Follow-up from check pass 3 (not built)

- #1 `clipStrings` (`src/mcp/tools.ts:49`) also cuts `links[].url` on an oversize reply: add `url` to `UNCLIPPED_FIELDS`.
- #2 `working` vs the group rules: settled by the Decision above; no work.
- #3 `ask_human` on an existing item passes `after_answer ?? null` (`src/application/board.ts:113-116`) and erases a stored `after_answer`: pass `undefined`.
- #4 `parseConfig(ctx.rawConfig)` runs per call, so a config error fails `ask_human` on the waiting_for_me create path: read it lazily in `askOnItem`.
- #5 the doc-synced check reads a stale find, then `loadForSync` again: return `in_doc_sync` from the first find.
- #6 `fitItem` (`src/mcp/tools.ts:144`) can fall back to a bare `{key}` or a clipped `details_md` with a note about events only.
- #7 a done report with `needs_you` drops it with a success reply: settled by Slice 13 #2; no work.
- #8 whitespace-only `needs_you` with no `why` is neither refused nor a clear.
- Low: `SLICE_CHILD_TYPES` (`src/api/board.ts:95`) now includes Check; the comments still say "part, bug or problem" and no test pins the check case.

#### For CLAUDE.md

- `list_open` and `get_item` replies are cut at 50,000 characters (Claude Code's own text-result limit) only by `cutReply` in `src/mcp/tools.ts`; it never clips ids or times, and its note names the first dropped key. Never add a second cut (Slice 32: docs/plan/slices/32-questions-and-rules.md).

#### Not yet verified

- A live `ask_human` from a chat sets `needs_you` on its card, after the release.
