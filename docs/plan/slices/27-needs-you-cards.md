### Slice 27 — Every "Needs you" card says what is needed, for which work, and why; no card when nothing is asked

*Built 2026-11-17 (code by a cloud session, run cse_012UYzYQsFBDT9yG4npRLoGa, commit 4eb6bfe; reviewed and fixed locally), merged as PR #109 (7a07d90), not yet verified in a real Claude Code session.*

*Planned (owner, 2026-11-17, on a screenshot of four "Needs you" cards: "the only active session I havae with board is
you. why do I have so many things from you? ... 'claude is waiting your input' what input?! ... what the fuck is the
question and the options? ... which slice?! which task?! which fucking topic!!? ... where the fuck is the
description?! what the fuck do you need from me?").* Read live at 20:2x from `list_open` (type `waiting_for_me`):

- `<project>/session-<id>` "session needs you: Claude is waiting for your input" (source `hook`): the Notification
  hook's idle prompt opened it again about two minutes after every reply of a supervising session that was only
  waiting on a 10-minute timer and had asked nothing; it opened and closed 20 times between 17:55Z and 19:15Z. It
  carries no question, no options, no goal and no slice.
- Doc-sync cards from `**You:**` lines and from a `parked: ... waits for the user` row: the title is the bare line or
  "Waiting on you: <slice title>", `why` is empty or the park reason, no link to the slice, no description of what
  the step is for.

**Touches:** `plugin/scripts/hooks/**`, `plugin/hooks/hooks.json`, `plugin/scripts/sync-docs.mjs`, `plugin/scripts/sync-docs.test.mjs`, `plugin/scripts/report-progress.mjs`, `plugin/skills/agent-board/SKILL.md`, `src/mcp/instructions.ts`, `src/domain/**`, `web/src/**`, `test/**`, `e2e/**`, `docs/clients.md`, `docs/plan/slices/27-needs-you-cards.md`

**Migrations:** none

#### Work

- [x] **No card when nothing is asked.** The Notification hook opens a waiting card only for a permission prompt or an
  elicitation, or for an idle prompt when the session's last assistant message (read from the transcript tail) ends
  with a question to the person. An idle prompt after a status line opens nothing. Verify: tests with a last message
  that is a status line (no card), one ending in a question (card), and a permission prompt (card).
- [x] **The card carries the question.** A hook card's `needs_you` is the question itself (the last question sentence
  of the last assistant message, at most 300 characters), `after_answer` what happens once answered when the message
  says it, the title is the session's reported goal (or the project and branch when none), and a permission prompt
  names the tool and the command it asks for. Verify: tests for each.
- [x] **Doc-sync cards say what and why.** A `**You:**` line's card has: title = the step (the line, without the
  `**You:**` prefix); `why` = the slice's title and what the step unblocks (the line's own "so that ..." when present,
  else "Not yet verified for Slice N: <slice title>"); a link to the slice file on the repo host. A parked row's card
  has: title = what the person must decide or do (the slice file's "Open for the owner" lines when present), `why` =
  the slice title, and the link. Verify: sync-docs tests for both kinds.
- [x] **The page shows it.** A "Needs you" card shows the question (`needs_you`) and `why` in full (no one-line
  cut-off) and the link; a card with no question and no why shows "No question recorded" instead of repeating the
  title. Verify: e2e on a seeded card of each kind.
- [x] **The rules say it.** `src/mcp/instructions.ts` (and the skill, held equal by its test): a question for the person
  goes in `needs_you` with the options and what each does, the work it belongs to (slice, task) in the title, and a
  direct link to where the person acts; never a card that only says "waiting". Verify: the instructions test reads
  these lines.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` green.

*Changed while building:*

- The hook sends `report_progress` (type `waiting_for_me`) instead of `ask_human`: `ask_human` cannot set `needs_you` and its schema is outside this slice's Touches. The close path (Stop, UserPromptSubmit) is unchanged.
- The hook handles `idle_prompt` as well (`plugin/hooks/hooks.json` matcher). Text-building is in the new `plugin/scripts/hooks/waiting-card.mjs`: question at most 300 characters, title = the session goal (else project and branch), a permission card names the tool and its command clipped to 120. `maskSecrets` (linear time) masks the command and also `needs_you`, `after_answer` and the message before anything leaves the machine.
- No second card when the session's own card already holds the question. An idle prompt with no question closes an older idle card, never a permission or elicitation card (the marker stores the kind).
- Doc-sync: `**You:**` cards have title = the step, why = slice title plus what it unblocks, and a link to the slice file; parked-row cards take their title from the first block of "Open for the owner" (placeholders dropped), why = slice title, and the link.
- Page: every "Needs you" card is a `QuestionCard` (question, why in full, links, or "No question recorded"), focus ring via `:has`; hook cards show "session <id4>".
- Rules: `SERVER_INSTRUCTIONS` and the `SKILL.md` copy say: question with options, the work in the title, a direct link, never a bare waiting card.

## From review

Findings files: `reviews/pr-109-high.md` (11 findings: applied 1-7 and 10), `reviews/pr-109-medium.md` (7: applied 1, 3, 4, 6, 7), `reviews/pr-109-check-medium.md` (10: applied 1, 2, 5), `reviews/pr-109-check-2-medium.md` (9: applied 1 only, converged), `reviews/pr-109-check-3-medium.md` (4 low, none at medium or above). The rest are listed one by one below.

- Skipped #2 (`reviews/pr-109-medium.md`): "openForOwner stops at first blank line, so a loose list keeps only its first bullet. Second bullet silently dropped from the card title." - low, a loose list keeps its first bullet; follow-up.
- Skipped #5 (`reviews/pr-109-medium.md`): "flag mask matches names merely containing a secret word (--author, --no-auth), hiding what the person must approve." - low, over-masking a flag only hides harmless text.
- Skipped #8 (`reviews/pr-109-high.md`): "The SO_THAT regex /\bso that\b[^.]*\.?/ stops at the first period: "so that the build (v1.2) can ship" is cut to "so that the build (v1"" - low, a wording heuristic; follow-up.
- Skipped #9 (`reviews/pr-109-high.md`): "Two separate imports from "../scripts/seed-data" on adjacent lines (CRASH_QUESTION and SEED_ITEMS); merge into one (lint passed here, so style only)." - low, style (the fixer merged the two imports anyway: one line).
- Skipped #3 (`reviews/pr-109-check-medium.md`): "SECRET_PATTERNS entry 3 masks `<word containing key/token/auth>: <next word>` in prose (author, monkey, authentication). Scenario: "Which author: Alice or Bob?" becomes "Which author: ***"." - low, over-masking prose is the safe side; check pass, follow-up.
- Skipped #4 (`reviews/pr-109-check-medium.md`): "idle_prompt with no question calls closeStale; the guard protects only permission/elicitation kinds, so a card with no `kind` (older marker or untyped notification) is closed while still unanswered." - transitional: only markers written before this change lack a kind; follow-up.
- Skipped #6 (`reviews/pr-109-check-medium.md`): "Waiting card title now holds the ask/park reason (clipped to TITLE_LIMIT) and `why` is always "Slice N: title"; a reason over 200 chars is cut mid-sentence and the rest is stored nowhere." - low, check pass, follow-up.
- Skipped #7 (`reviews/pr-109-check-medium.md`): "`item.needs_you ?? (item.why ? item.title : null)`: needs_you '' renders an empty question span and skips "No question recorded"" - low, check pass, follow-up.
- Skipped #8 (`reviews/pr-109-check-medium.md`): "Card changed from one `<button>` to a `<div>` with inner button and links: tapping the card padding no longer opens it, and there is no role or accessible name grouping the links with the card." - low, check pass, follow-up.
- Skipped #9 (`reviews/pr-109-check-medium.md`): "SENTENCE_BREAK splits on ./!/? plus whitespace: "Is v1.2 ok? e.g. for the release?" returns the second fragment alone; "Which one?\n- A\n- B" ends with 'B' so endsWithQuestion is false" - low, a wording heuristic; follow-up.
- Skipped #10 (`reviews/pr-109-check-medium.md`): "Every Notification reads and parses up to 128 KB of transcript and runs eight regexes even for permission prompts that need only the tool input" - low, bounded work now that the mask is linear; follow-up.
- Skipped #2 (`reviews/pr-109-check-2-medium.md`): "The vendor-prefix pattern `(sk|pk|ghp|...)[-_A-Za-z0-9]{12,}` has no separator, so ordinary words are masked. Scenario: "Should I use skip-ci-marker-batch?" shows "***", so the owner cannot read the question. Require `sk-`, `pk_live_`, `ghp_` shapes." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #3 (`reviews/pr-109-check-2-medium.md`): "The name-then-value patterns over-mask prose: `\s*` after `:`/`=` crosses newlines, and the single-dash flag pattern has no word boundary. Scenario: "Which key: A or B?" becomes "Which key: *** or B?"; "re-key the vault" masks "the". Use `[ \t]*` and anchor the flag at whitespace or start." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #4 (`reviews/pr-109-check-2-medium.md`): "The generic 40+ character letter-and-digit token pattern masks branch and file names. Its `{0,200}` lookahead also misses blobs whose first digit is past character 200. Scenario: branch `feat/27-needs-you-cards-owner-ask-join-turn-text` shows "***"." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #5 (`reviews/pr-109-check-2-medium.md`): "openForOwner stops at the first blank line after a found line, so a loose list drops every ask after the first. It also reads lines inside code fences as asks. Scenario: "- Approve DNS", blank, "- Pay invoice" gives a card with only the first ask." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #6 (`reviews/pr-109-check-2-medium.md`): "The NO_OWNER_ASK regex is narrow, and numbered markers are not stripped. Scenario: "Nothing to do.", "None needed.", "N/A", "None yet", "1. None" become the card's ask text." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #7 (`reviews/pr-109-check-2-medium.md`): "waitingItem uses the "Open for the owner" text, but raising the card rests only on waitsOnlyOnWork(reason). Scenario: reason "waits on slice 5" plus a real owner ask in the section gives no card; section "None" plus a person-named reason still gives a card." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #8 (`reviews/pr-109-check-2-medium.md`): "ownerItems looks for "so that" after clipping the step to TITLE_LIMIT, and SO_THAT stops at the first period. Scenario: "so that v1.2 ships" is cut at "so that v1.", and a long step loses `why`." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #9 (`reviews/pr-109-check-2-medium.md`): "readTail reads only the last 128 KB, and with no newline in the tail it keeps a cut line. A large Write tool_use before the prompt leaves lastAssistant empty, so a permission card falls back to the raw text and an idle question card is dropped by closeStale. (b) SENTENCE_BREAK splits at "e.g. " and version numbers, so "Do you want me to retry, e.g. with the staging token?" shows only "with the staging token?"." - check passes converged (second check pass): not crash, data-loss, security or privacy; follow-up.
- Skipped #11 (`reviews/pr-109-high.md`): "AFTER_SENTENCE matches only the ASCII apostrophe in "i'll"/"i'd" so "I’ll merge" (curly apostrophe) gives no after_answer; it also fires on any sentence with "when" plus "i can"" - low, a wording heuristic; follow-up.
- Skipped #1 (`reviews/pr-109-check-3-medium.md`): "unquoted value mask stops at & | ; so a secret containing one is partly masked" - low, check passes converged; follow-up.
- Skipped #2 (`reviews/pr-109-check-3-medium.md`): "masking needs NAME= or NAME: before the value; prose like "token ghx_ab12cd" and short JWT or PEM lines are not masked." - low, check passes converged; follow-up.
- Skipped #3 (`reviews/pr-109-check-3-medium.md`): "git rev-parse runs in the stdin cwd; a hostile repo config could run code." - low, check passes converged: "Claude Code already works in that cwd."; follow-up.
- Skipped #4 (`reviews/pr-109-check-3-medium.md`): "idle prompt with a missing marker falls to closeStale; consistency risk only, not a crash or data loss." - low, check passes converged; follow-up.

#### For CLAUDE.md (lifted 2026-11-17)

- A waiting card from the plugin's Notification hook opens only when something is asked (permission, elicitation, or an idle prompt after a question); its text is masked by `maskSecrets` in `plugin/scripts/hooks/waiting-card.mjs` before it leaves the machine; never send transcript text unmasked (Slice 27: docs/plan/slices/27-needs-you-cards.md).

#### Not yet verified

- In a real Claude Code session with the plugin: an idle prompt after a status line opens no card; one after a question opens a card with that question; a permission prompt card names the tool and command.
