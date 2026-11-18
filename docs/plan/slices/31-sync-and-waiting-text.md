### Slice 31 — Plan sync and waiting cards read the documents and transcripts right

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 1.

*Built (wave 2026-11-18), PR #131.* Touches widened with `plugin/scripts/hooks/hooks.test.mjs`: there is no
session-waiting test file, so its tests go there (Slice 29 adds tests there too, in separate blocks).

**Touches:** `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`,
`plugin/scripts/hooks/waiting-card.mjs`, `plugin/scripts/hooks/waiting-card.test.mjs`,
`plugin/scripts/hooks/session-waiting.mjs`, `plugin/scripts/hooks/hooks.test.mjs`, `docs/setup/plan-sync.md`,
`docs/plan/slices/31-sync-and-waiting-text.md`

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
- The secret mask is one name rule (review round 4, owner's design): a word whose lowercase letters-only form contains
  password, passwd, pass, pwd, secret, token, apikey, key, auth, cookie, session, credential or privatekey, followed by `=`,
  `:`, `is`/`was` (or a space after a `--flag`), masks the rest of the line, with no value-shape test. A line that ends
  with such a name and separator and no value masks the whole next non-empty line. Masking runs per whole line before
  any sentence split; the question and after-answer sent are slices of the line-masked text, with bounds taken from
  the split of the unmasked text. Over-masking is
  the accepted cost: prose like "Session: expired, retry?" is masked after the colon (and "the token is expired" after
  "is"), and a question so masked opens no idle card. The shape maskers (JWT, AKIA/AIza, vendor prefixes, long tokens,
  URL passwords) stay. Every text of a waiting card, its title included, goes through `maskSecrets`.
- The mask is a deny-list and cannot be complete: it errs to over-masking, and gaps found later are follow-ups, not
  reasons to hold the slice.

#### Work

Plan sync (`sync-docs.mjs`):
- [x] c2 #1: `waitsOnlyOnWork` (`:237-240`) is a deny-list (`NAMES_PERSON`, `:44`). A reason that names the owner in
  other words loses its waiting card. Turn it into an allow-list of reasons that wait only on work.
- [x] c2 #2: `readSliceTexts` (`:525-535`) matches a slice file by the first dash segment of its name, with no
  uniqueness check. Match the whole number and refuse an ambiguous match.
- [x] check #6: add a test that reads `plugin/skills/agent-board/SKILL.md` and `docs/setup/plan-sync.md` and checks
  that their park-reason words match `waitsOnlyOnWork`. Today `sync-docs.test.mjs:329-334` only greps for the You
  line.
- [x] high #4 / med #7 / check #7: `ownerItems` (`:401-417`) makes cards for `Slice N` blocks that have no status
  row.
- [x] high #6 / med #3 / check #2: `gitSource.read` (`:486-500`) runs `ls-tree` and `show` for each file with a
  10 s timeout each, and has no overall deadline.
- [x] high #9: on overflow, a dry run prints `[]` (`main` at `:621`; `capItems` at `:447-449`).
- [x] med #5: `main` at `:628` prints `created=undefined` when the reply has no counts.
- [x] med #9 / check #4: `PARK_NOTE` (`:46`) uses the `/im` flags and matches any line.
- [x] Slice 27 med #2 + c2 #5: `openForOwner` (`:248-259`) stops at the first blank line (`:254`) and doesn't skip
  code fences, so later asks are lost.
- [x] Slice 27 high #8 + c2 #8: `SO_THAT` (`:393`) stops at the first period, and is applied after clipping
  (`:396`, `:406`).
- [ ] *Not built: `sync_snapshot` takes no `details_md` (`src/mcp/schemas.ts` `snapshotItem`, `newRow` in `src/domain/docSync.ts` sets it null), so the rest of a clipped title has nowhere to go. It needs `details_md` added to `snapshotItem` (`src/mcp/schemas.ts`) and `newRow` (`src/domain/docSync.ts`), both outside this slice's Touches; it goes to the open slice whose Touches has both files (the sync and checks rules).* Slice 27 chk #6: the title is clipped to 300 characters (`:270`) and the rest is stored nowhere. Put the rest
  in `details_md`.
- [x] Slice 27 c2 #6, c2 #7: `NO_OWNER_ASK` (`:246`) is narrow and leaves numbered markers in; the `waitingItem`
  text (`:265-272`) and `waitsOnlyOnWork` are decoupled.
- [x] check #5 (`WAIT_LEAD`, `:32`, narrow by design): no change; this line is the record.

Waiting cards (`waiting-card.mjs`, `session-waiting.mjs`):
- [x] Slice 27 med #5, chk #3 + c2 #3, c2 #2, c2 #4, c3 #1, c3 #2: the secret mask (`waiting-card.mjs:21-28`). It
  has no word boundary before the flag or secret word, its whitespace after a colon crosses newlines, the
  vendor-prefix pattern has no separator, the generic 40+ character token rule masks branch names, it stops at
  `&`, `|` and `;`, and it needs `NAME=` before the value. Write one table-driven test of shapes to mask and shapes
  to leave alone.
- [x] Slice 27 high #11: `AFTER_SENTENCE` (`:30`) matches only the ASCII apostrophe.
- [x] Slice 27 chk #9 + c2 #9: `SENTENCE_BREAK` (`:14`) splits on "e.g." and on version numbers. `readTail` keeps a
  cut-off first line; drop it.
- [x] Slice 27 chk #10: every Notification reads and parses a 128 KB transcript tail. Read only as far back as the
  last assistant entry. That also fixes the 128 KB window cutting the assistant entry, named in plan.md.
- [x] *Built (the review round gave this slice `titleOf` for the wave): the stdin `cwd` is used only when it is an absolute existing folder (`usableCwd`), git runs with `-c` overrides that switch off the repo's hooks, fsmonitor, pager and askpass (`GIT_BRANCH_ARGS`), and a closed goal's title is no longer sent on a waiting card (Slice 29 review, `reviews/pr-129-high.md` #2).* Slice 27 c3 #3: `session-waiting.mjs:29` runs `git rev-parse` in the stdin `cwd`.

#### Verification

- `npm test`. New tests: in `sync-docs.test.mjs`, one per sync item plus the park-rule equality test; in
  `waiting-card.test.mjs`, the mask table and the sentence cases.
- One real dry run against this repo's plan: `node plugin/scripts/sync-docs.mjs --dry-run`, checked for no
  `undefined` and no `[]` on overflow.

#### From review

- Review files read in full: `reviews/pr-131-high.md` (9 findings), `reviews/pr-131-medium.md` (8), `reviews/pr-131-check-medium.md` (10), `reviews/pr-131-check-2-medium.md` (4), `reviews/pr-131-check-3-medium.md` (6), `reviews/pr-131-check-4-medium.md` (4). Outcomes confirmed by the fixers' reports (coordinator triage):
- Applied in file pr-131-high.md: #1, #2, #3, #4, #5, #6, #8, #9. #7: see its line below.
- Applied in file pr-131-medium.md: #1, #3, #4, #6, #7, and #8 by reading `.git/HEAD` instead of running git. #2 and #5: see their lines below.
- Applied in file pr-131-check-medium.md: #4 (`branchOf` walks up to the first `.git`), #5, #6. #1, #2, #3, #7, #9, #10 settled by the one name rule, below. #8: see its line below.
- Skipped #7 (`reviews/pr-131-high.md`): "lastAssistant widens its read window up to four times (16 KB, 128 KB, 1 MB, 4 MB), re-opening, splitting and parsing each time." - the windows stop at the first whole last turn, so the 4 MB read happens only for a giant last turn, once per Notification hook; no fault.
- Skipped #2 (`reviews/pr-131-medium.md`): "unquoted NAME_VALUE run now `[^\s'"]+`, no longer stops at `;` `&` `|`, and trailing `;` is dropped." - the text leaves the machine, so masking the shell text after `;` or `&&` errs on the private side; kept.
- Skipped #5 (`reviews/pr-131-medium.md`): "parkNote reads only the header (to the second heading) and emphasis-wrapped lines. Scenario: existing slice files with `*Parked: ...*` under a later heading lose their park note" - the slice's own Work line for PARK_NOTE says the note is read "only in the slice header"; reading later headings is a new rule, not a fault.
- Skipped #8 (`reviews/pr-131-check-medium.md`): "parkNote reads only above second heading and PARK_NOTE needs italic/bold" - the slice's Work line for PARK_NOTE reads the note only in the slice header with a marker; a plain "Parked:" line elsewhere is a new rule.
- Settled by the one name rule (`reviews/pr-131-check-medium.md`): #1 "isSecretName strips trailing 's' so \"pass\" never matches; PASS=, DB_PASS=, --pass go out in clear.", #2 "unquoted value stops at first whitespace; \"Cookie: sid=abc; other=def\" and \"Password: correct horse battery\" leak the rest.", #3 "name limit 80 plus lookbehind means a 90-char name ending _token=abc is not masked (FLAG_VALUE caps 60).", #9 "\"pass\", \"session\", \"key\", \"auth\", \"cookie\" as secret names over-mask prose like \"Session: expired, retry?\"" (accepted cost, see Decisions), #10 "SAID_VALUE masks only values with a digit or 12+ chars; \"the password is horse\" stays in clear." - one table-driven test holds each case.
- Changed after round 4 (`plugin/scripts/hooks/waiting-card.mjs` `cardText`): whether a card opens and which sentence is the question are now decided on the unmasked text and only the text that leaves is masked, so "Session: expired, retry?" opens a card reading "Session: ***" (a masked line had lost its question mark).
- Settled by masking the title (`reviews/pr-131-check-medium.md`): #7 "waiting-card title (branch or goal title) not passed through maskSecrets, unlike needs_you/after_answer." - `session-waiting.mjs` masks the title.
- Fixed #1 (`reviews/pr-131-check-2-medium.md`): "A bare \"key\" is not a secret name; the slice's name list (Decisions) has apikey and privatekey but not key." - `key` added to `SECRET_PARTS` and the Decisions line (contains-match, over-masking accepted).
- Fixed #2 (`reviews/pr-131-check-2-medium.md`): "maskNameValue masks nothing when the separator is last on its line (rest.trim() !== '')." - a name and separator with no value now masks the whole next non-empty line.
- Fixed #3 (`reviews/pr-131-check-2-medium.md`): "NAME_SEPARATOR consumes [^\r\n]* on each non-maskable match, then restarts one word later: quadratic on a long single line." - replaced by a per-line linear scan (`maskLine`); a timing test masks an 80k-word line in under 200 ms.
- Fixed #4 (`reviews/pr-131-check-2-medium.md`): "questionOf/afterAnswerOf mask one sentence at a time after SENTENCE_BREAK splits the text; a secret value containing \". \" or \"? \" is cut and the later part has no name before it." - lines are masked whole first; sentences are sliced from the masked text by bounds from the unmasked split.
- Fixed #1 (`reviews/pr-131-check-3-medium.md`): "Escaped-quote JSON not masked. `curl -d \"{\\\"password\\\":\\\"hunter2\\\"}\"` returns unchanged" - the scanned copy of each line drops the backslash of `\"` and `\'` (`unescapedCopy` in `waiting-card.mjs`), mapped back to the line for the mask point.
- Fixed #2 (`reviews/pr-131-check-3-medium.md`): "Short flags leak: `docker login -u me -p hunter2` unchanged (reproduced); `mysql -phunter2 db` too." - `SHORT_FLAG` masks the value after `-p -k -t -s -a` (either case, spaced or glued) after a command word; `tar -tf x` masks "f x" (accepted).
- Fixed #3 (`reviews/pr-131-check-3-medium.md`): "maskLongToken carve-out contexts `fix/`, `plan/`, `feature/` also match URL segments, so a long passphrase slug is kept." - the carve-out is gone: a 40+ character run with a letter and a digit is always masked; branch names come from .git/HEAD, never from the masked text.
- Fixed #4 (`reviews/pr-131-check-3-medium.md`): "Two `{0,200}` lookaheads at every word boundary: `maskSecrets('a-'.repeat(1500000))` takes 6.3 s" - the lookaheads are gone (run matched once, tested after), and by construction only a bounded window is masked: `MASK_WINDOW` (4096) tail of the assistant text, head of a command or message; a timing test with the 1.5M `a-` line finishes under 200 ms.
- Fixed #5 (`reviews/pr-131-check-3-medium.md`): "Colon on the next line is not masked: `{\"token\"\n:\"abc\"}` unchanged." - a secret name that ends a line (`ends`) masks the next non-empty line whole when it starts with `:` or `=`.
- Fixed #6 (`reviews/pr-131-check-3-medium.md`): "PEM block after a `private_key` line: header and short body lines pass." - a shape masker masks `-----BEGIN ... -----` to `-----END ... -----` (or the end of the text), across lines.

- Follow-up #1-#4 (`reviews/pr-131-check-4-medium.md`): "Finding 2 only partly fixed: `shortFlagPoint` needs non-blank text before the flag on the same line, so a flag leading a continuation line leaks.", "Finding 1 fixed for one escape level only", "`tailOf` cuts the text to the last 4096 chars before masking, so a PEM whose BEGIN header falls before the cut leaves body lines unmasked", "Title is clipped to 200 chars in `titleOf` and then masked" - all four go to Follow-ups below: the mask is a deny-list (Decisions), gaps found later are follow-ups.

#### Follow-ups

- `reviews/pr-131-check-5-medium.md` (test-only lows after the fixtures were built from parts so GitHub push protection accepts them; npm test exit 0 on rerun, 488 vitest, waiting-card tests 28 of 28): PEM header literals still whole in `waiting-card.test.mjs` (#1); no fixtures for the AIza, github_pat_, xox, pk_/rk_ and gho/ghs/ghu/ghr maskers (#2); later names on a multi-name row untested (#3); over-masking is now the expected result, as the Decisions say (#4); split style (#5); wall-clock timing tests can flake (#6).

- `reviews/pr-131-check-3-medium.md`: "branchOf can read an unrelated ancestor repo's branch when cwd is unusable and falls back to the hook's folder." - not fixed here (not a finding); `branchOf` in `session-waiting.mjs` should not fall back to the hook's own folder. `reviews/pr-131-check-4-medium.md` repeats it ("branchOf can read an unrelated ancestor repo's branch when cwd is unusable"; wrong text, no leak).
- Deny-list gaps named in `reviews/pr-131-check-4-medium.md`: "`The password is\nhunter2` (is/was at line end, value on next line) unmasked" and "`psql -W hunter2` (SHORT_FLAG letters p,k,t,s,a only)", plus its four findings above.
- Not built: Slice 27 chk #6 (the rest of a clipped title in `details_md`). It needs `snapshotItem` in `src/mcp/schemas.ts` and `newRow` in `src/domain/docSync.ts`; it goes to Slice 33, whose Touches has both.

#### Verification record

- `npm run lint` and `npm run typecheck` clean; `npm test` exit 0 on the final tree (488 vitest, 309 plugin node tests). No device run: plugin scripts only, no UI.

#### For CLAUDE.md

- The waiting-card mask `maskSecrets` in `plugin/scripts/hooks/waiting-card.mjs` is a deny-list: a secret name followed by a separator masks the line to its end (the next line too when the value is on it), plus shape maskers; input is cut to a 4096-character window and scanned linearly. Whether a card opens and which sentence is the question are decided on the unmasked text; only the text that is sent is masked. The waiting-card title reads the branch from `.git/HEAD` (`titleOf` in `plugin/scripts/hooks/session-waiting.mjs`), never by running git (Slice 31: docs/plan/slices/31-sync-and-waiting-text.md).

#### Not yet verified

- A real Notification hook run on the owner's machine opens a waiting card with masked text.
- A real plan sync from a repo with parked slices.
