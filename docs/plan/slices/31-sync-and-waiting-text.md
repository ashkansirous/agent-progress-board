### Slice 31 — Plan sync and waiting cards read the documents and transcripts right

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 1.

**Touches:** `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`,
`plugin/scripts/hooks/waiting-card.mjs`, `plugin/scripts/hooks/waiting-card.test.mjs`,
`plugin/scripts/hooks/session-waiting.mjs`, `docs/setup/plan-sync.md`, `docs/plan/slices/31-sync-and-waiting-text.md`

**Migrations:** none

#### Why

These are the open review findings of Slice 23 (`docs/plan/slices/23-plugin-plan-sync.md`, *From review*) and the
plugin-side skips of Slice 27 (`docs/plan/slices/27-needs-you-cards.md`, *From review*). The worst ones: a park reason
that names the owner in other words loses its waiting card; the slice file is matched by the first dash segment of its
name; an owner ask after a blank line is dropped; the secret mask misses some shapes. Already gone, so not planned:
Slice 27 chk #7 (an empty `needs_you` now renders "No question recorded"), high #9 (style), and chk #4 (kindless
markers expire). Slice 23 med #6 and med #10 were decided at review time.

#### Decisions

- The park-reason rule stays in one place, `waitsOnlyOnWork` (root `CLAUDE.md`, Slice 23 rule). This slice adds the
  test that keeps `SKILL.md` and `docs/setup/plan-sync.md` matching it. `SKILL.md` is only read here; if its words
  must change, that change goes in Slice 32, which owns the file.
- Text leaves the machine only after `maskSecrets` (root `CLAUDE.md`, Slice 27 rule). When a mask fix is unsure,
  mask more, not less.

#### Work

Plan sync (`sync-docs.mjs`):
- [ ] c2 #1: `waitsOnlyOnWork` (`:237-240`) is a deny-list (`NAMES_PERSON`, `:44`). A reason that names the owner in
  other words loses its waiting card. Turn it into an allow-list of reasons that wait only on work.
- [ ] c2 #2: `readSliceTexts` (`:525-535`) matches a slice file by the first dash segment of its name, with no
  uniqueness check. Match the whole number and refuse an ambiguous match.
- [ ] check #6: add a test that reads `plugin/skills/agent-board/SKILL.md` and `docs/setup/plan-sync.md` and checks
  that their park-reason words match `waitsOnlyOnWork`. Today `sync-docs.test.mjs:329-334` only greps for the You
  line.
- [ ] high #4 / med #7 / check #7: `ownerItems` (`:401-417`) makes cards for `Slice N` blocks that have no status
  row.
- [ ] high #6 / med #3 / check #2: `gitSource.read` (`:486-500`) runs `ls-tree` and `show` for each file with a
  10 s timeout each, and has no overall deadline.
- [ ] high #9: on overflow, a dry run prints `[]` (`main` at `:621`; `capItems` at `:447-449`).
- [ ] med #5: `main` at `:628` prints `created=undefined` when the reply has no counts.
- [ ] med #9 / check #4: `PARK_NOTE` (`:46`) uses the `/im` flags and matches any line.
- [ ] Slice 27 med #2 + c2 #5: `openForOwner` (`:248-259`) stops at the first blank line (`:254`) and doesn't skip
  code fences, so later asks are lost.
- [ ] Slice 27 high #8 + c2 #8: `SO_THAT` (`:393`) stops at the first period, and is applied after clipping
  (`:396`, `:406`).
- [ ] Slice 27 chk #6: the title is clipped to 300 characters (`:270`) and the rest is stored nowhere. Put the rest
  in `details_md`.
- [ ] Slice 27 c2 #6, c2 #7: `NO_OWNER_ASK` (`:246`) is narrow and leaves numbered markers in; the `waitingItem`
  text (`:265-272`) and `waitsOnlyOnWork` are decoupled.
- [ ] check #5 (`WAIT_LEAD`, `:32`, narrow by design): no change; this line is the record.

Waiting cards (`waiting-card.mjs`, `session-waiting.mjs`):
- [ ] Slice 27 med #5, chk #3 + c2 #3, c2 #2, c2 #4, c3 #1, c3 #2: the secret mask (`waiting-card.mjs:21-28`). It
  has no word boundary before the flag or secret word, its whitespace after a colon crosses newlines, the
  vendor-prefix pattern has no separator, the generic 40+ character token rule masks branch names, it stops at
  `&`, `|` and `;`, and it needs `NAME=` before the value. Write one table-driven test of shapes to mask and shapes
  to leave alone.
- [ ] Slice 27 high #11: `AFTER_SENTENCE` (`:30`) matches only the ASCII apostrophe.
- [ ] Slice 27 chk #9 + c2 #9: `SENTENCE_BREAK` (`:14`) splits on "e.g." and on version numbers. `readTail` keeps a
  cut-off first line; drop it.
- [ ] Slice 27 chk #10: every Notification reads and parses a 128 KB transcript tail. Read only as far back as the
  last assistant entry. That also fixes the 128 KB window cutting the assistant entry, named in plan.md.
- [ ] Slice 27 c3 #3: `session-waiting.mjs:29` runs `git rev-parse` in the stdin `cwd`.

#### Verification

- `npm test`. New tests: in `sync-docs.test.mjs`, one per sync item plus the park-rule equality test; in
  `waiting-card.test.mjs`, the mask table and the sentence cases.
- One real dry run against this repo's plan: `node plugin/scripts/sync-docs.mjs --dry-run`, checked for no
  `undefined` and no `[]` on overflow.
