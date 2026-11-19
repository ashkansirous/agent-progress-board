### Slice 44 — English only, and an owner step reads as a short title plus its steps

*Planned 2026-11-19. The owner, on the "Needs you" cards: "I didnt ask for a fucking german text! this project has no
fucking language than english! Also, I told you fucking before no to put bullshit task that I cannot do on me!" and,
on the cloud card (a 300-character run-on title): "how the fuck am I supposed to read this fucking text?! this should
be title: slice XXX: set the environment variables for claude-environment. description: go to https://claude.ai/code
click on xxx and complete 2 steps."* Starts after Slice 43 (both edit `plugin/scripts/sync-docs.mjs` and the card
components).

*Built 2026-11-19, merged as PR #160 (ee47e3f); the two Verification lines need the release.*

**Touches:** `web/src/strings.ts`, `web/src/App.tsx`, `test/web.test.ts`, `test/partsWeb.test.ts`,
`test/capCostFormat.test.ts`, `test/planningText.test.ts`, `test/sessionWeb.test.ts`, `test/usageWeb.test.ts`, `e2e/projects.spec.ts`, `web/src/cards.ts`,
`web/src/SessionCards.tsx`, the e2e spec and fixture that cover owner-step cards, `docs/setup/plan-sync.md`, `docs/clients.md`,
`plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`, `plugin/skills/agent-board/SKILL.md`,
`src/mcp/instructions.ts` (only if it describes the owner-step line), `docs/plan/slices/44-english-only-owner-steps.md`

**Migrations:** none

#### Why

- Slice 2 (2026-11-15) added a German string table (`const de: Table`, `web/src/strings.ts:401-797`) and picks it from
  the browser language (`pickLocale`, `:810`). The owner never asked for it, and that table then produced owner
  checks for a native German read (Slices 9 and 35). Those checks were removed from `docs/plan/unverified.md` on
  2026-11-19.
- The doc sync turns a whole `**You:**` line into the card title (clipped to 300 characters), so a step with several
  parts becomes an unreadable run-on title with no slice number in front.

#### Decisions

- **English only:** remove the `de` table, `pickLocale` and the per-locale plural lookup. The page always uses the
  English table, and number and date formats stay in the viewer's locale through `Intl`, as today. Any test that ran
  German goes or switches to English.
- **Owner step format:** a `docs/plan/unverified.md` line is `**You:** <short action> | <steps>`. The doc sync makes
  the card title `Slice <N>: <short action>` and its description the steps (with `<board address>` resolved as in
  Slice 43). A line with no `|` keeps today's behaviour, except the title gets the `Slice <N>: ` prefix and is cut at
  80 characters with the rest in the description. Example: title "Slice 28: Set the environment variables for the
  Claude environment"; description "Go to https://claude.ai/code, open your environment's settings, and complete 2
  steps: 1. ... 2. ...".
- `plugin/skills/agent-board/SKILL.md` and the run-all-waves owner-step rule (in the owner's config repo) describe the
  same format. The config repo's copy is the owner's side and is noted, not edited, here.

#### Work

- [x] Remove the German table and locale picking; update strings tests and e2e.
- [x] `sync-docs.mjs`: split `**You:** <action> | <steps>` into title and description, prefix the slice number,
  apply the 80-character cut; tests for both forms.
- [x] `SKILL.md`: the owner-step line format.

#### Verification

- [ ] After the release, the page reads English on a browser set to German.
- [ ] A `**You:**` line in the new form shows on the board as "Slice N: <action>" with its steps underneath.

*Changed while building:*

- The German table, `LOCALES` and `pickLocale` are gone; `translator()` takes no argument and `App.tsx` fixes the Intl
  locale to "en" (what every non-German viewer already got).
- `sync-docs.mjs` (`ownerTitleFields`, `actionBar`): `**You:** <action> | <steps>` is split at the first ` | ` outside a
  code span; the title is `Slice N: <action>` cut at 80 (`OWNER_TITLE_LIMIT`), the cut-off part and the steps go to
  `details_md`; an empty action uses the steps as the action; a trailing bar is dropped. `plain()` and `checkHash` are
  unchanged, so existing check keys stay.
- Added after review: the owner-step card shows `details_md` under its title (`ownerStepDetails`, `stepUrls` in
  `web/src/cards.ts`, `SessionCards.tsx`), with `<board address>` filled and the links in the card's link row, so the
  steps no longer wait in the drawer.
- `docs/setup/plan-sync.md`, `docs/clients.md` and `plugin/skills/agent-board/SKILL.md` describe the format (the
  first two are now in Touches).
- Fast tests (fix round 2): 721 vitest, 396 plugin, 330 e2e passed, 4 skipped.

#### From review

*Reviews:* `reviews/pr-160-high.md` (7 findings), `reviews/pr-160-medium.md` (4), `reviews/pr-160-check-medium.md` (3).

- Applied: high #1, #3, #4, #5, #7; medium #1, #2, #3.
- Follow-ups, low, none applied (the check pass converged): check-medium #1 (`reviews/pr-160-check-medium.md`): a line already starting with `Slice N:` gets the prefix twice; #2: `actionBar` splits the raw line before `plain()`, so a bar inside bold or link text splits it; #3: board-address links are built twice (`addressLinks` and `stepUrls`) and hidden only by `dedupeLinks`.

- Skipped #2 (`reviews/pr-160-high.md`): "Existing cards keep an old details_md while the title is cut at 80." - a one-off for cards already synced; a line rewritten to the bar form gets a new checkHash key and a fresh details_md, and the COALESCE lives in `d1Repository.ts`, outside this slice's Touches.
- Skipped #4 (`reviews/pr-160-medium.md`): "The overflow of a cut title goes in front of the steps in details_md." - the Decision says the title is "cut at 80 characters with the rest in the description", so the cut-off part leads the description by the slice's own rule.
- Skipped #6 (`reviews/pr-160-high.md`): "The Decision says number and date formats stay in the viewer's locale through Intl, but `locale: "en"` is hard-coded." - the Decision says formats stay "through Intl, as today", and today every non-German viewer already got the "en" locale from `pickLocale`; passing `navigator.language` broke the setup e2e date.

#### For CLAUDE.md (lifted 2026-11-19)

- The owner-step title rule (`**You:** <action> | <steps>` into `Slice N: <action>` plus details) lives only in `ownerTitleFields` in `plugin/scripts/sync-docs.mjs`; the card's steps text only in `ownerStepDetails` in `web/src/cards.ts`. The page has one string table (English) and no locale picking (Slice 44: docs/plan/slices/44-english-only-owner-steps.md).

#### Not yet verified

- After the release, the page reads English on a browser set to German.
- A `**You:** ` line in the new form shows on the board as "Slice N: <action>" with its steps underneath.
