### Slice 44 — English only, and an owner step reads as a short title plus its steps

*Planned 2026-11-19. The owner, on the "Needs you" cards: "I didnt ask for a fucking german text! this project has no
fucking language than english! Also, I told you fucking before no to put bullshit task that I cannot do on me!" and,
on the cloud card (a 300-character run-on title): "how the fuck am I supposed to read this fucking text?! this should
be title: slice XXX: set the environment variables for claude-environment. description: go to https://claude.ai/code
click on xxx and complete 2 steps."* Starts after Slice 43 (both edit `plugin/scripts/sync-docs.mjs` and the card
components).

**Touches:** `web/src/strings.ts`, every `web/src` file that calls `pickLocale` or reads `LOCALES`, the tests and e2e
specs that use the `de` table, `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`,
`plugin/skills/agent-board/SKILL.md`, `src/mcp/instructions.ts` (only if it describes the owner-step line),
`docs/plan/slices/44-english-only-owner-steps.md`

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

- [ ] Remove the German table and locale picking; update strings tests and e2e.
- [ ] `sync-docs.mjs`: split `**You:** <action> | <steps>` into title and description, prefix the slice number,
  apply the 80-character cut; tests for both forms.
- [ ] `SKILL.md`: the owner-step line format.

#### Verification

- [ ] After the release, the page reads English on a browser set to German.
- [ ] A `**You:**` line in the new form shows on the board as "Slice N: <action>" with its steps underneath.
