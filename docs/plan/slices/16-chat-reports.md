### Slice 16 — Claude chat and Claude Design report to the board, and their use counts

*Planned.*

**Touches:** `src/api/oauth/**`, `src/api/auth.ts`, `src/mcp/tools.ts`, `src/mcp/schemas.ts`, `src/domain/capCost.ts`,
`src/domain/usage.ts`, `src/application/board.ts`, `test/**`, `docs/clients.md`, `README.md`, `CLAUDE.md`,
`docs/plan/slices/05-remote-mcp.md`, `docs/plan/slices/16-chat-reports.md`

#### Why

The owner, 2026-11-17, after a Claude Design session and two chats left nothing on the board:
"I said explicitly that I want to know the usage of all if possible but if not, I want their usage
to be taken into account in calculations. how the fuck did you go from that to we intentionally
build it in a way that they wont be able to report?!"

What happened, from the slice files: [Slice 5](05-remote-mcp.md) made every caller that signs in
through claude.ai read-only, "decided here", without asking the owner. [Slice 8](08-usage-reports.md)
then looked only for an official usage API for chat, Claude Design and other machines (owner's
decision 3, 2026-11-16), found none, and left that use in "not explained". Neither slice saw the
route the owner had already set up: the chat itself reporting through the board connector. The
read-only choice closed it. This slice opens it and uses it.

#### Decisions (owner, 2026-11-16 and 2026-11-17)

- Know the use of every source if possible; if not, take it into account in the calculations
  (owner, decision 3 of Slice 8, restated 2026-11-17).
- Chat and Claude Design sessions show on the board like any other session: goal, steps, what they
  need (the owner's 2026-11-17 decisions in [Slice 13](13-session-cards.md)).

#### Decided at the desk

- **A caller signed in through claude.ai can write.** The passphrase grant is the owner's own, so it
  gets the same tools as the write token: `report_progress`, `ask_human`, `mark_done`, `report_usage`,
  `report_cap`. `sync_snapshot` stays token-only (only a repo has plan documents). The CLAUDE.md line
  "OAuth callers are read-only" changes with it.
- **Its reports carry an environment** ("Claude chat" or "Claude Design", from what the caller sends;
  free text, never hard-coded) so they land in their own usage rows.
- **Use that a chat cannot read is placed in time.** A chat reports when it starts and ends a piece
  of work. The cap-cost fit ([Slice 9](09-cap-cost-estimate.md)) then puts cap growth that no token
  report explains, during a reported chat or Design window, against that environment instead of
  "not explained". If a chat can read its own token numbers, it sends them with `report_usage` and
  they count like any other.
- **How chat learns to report:** one short instruction text in `docs/clients.md` that the owner
  adds once to claude.ai (the owner's own login, the one step that stays theirs), plus the tool
  descriptions themselves, which say when to call each tool.

#### Work

- [ ] Check first and write the answers here, with sources: can a claude.ai chat or a Claude Design
  session call a custom connector's tools; can either read its own token use or cap percentage; where
  in claude.ai a standing instruction for every chat lives (its exact page address, for the owner's
  step).
- [ ] OAuth callers get the write tools above; tests for a write through an OAuth grant, a refused
  `sync_snapshot`, and the bearer paths unchanged. Find out whether existing grants carry the old
  scope; if they do, say so and give the owner the reconnect step with its link.
- [ ] Environment on reports from OAuth callers; tests.
- [ ] The fit puts unexplained growth inside reported chat or Design windows against their
  environment; tests with a window, without one, and two overlapping windows; the timing test in
  `test/capCost.test.ts` stays inside its bound.
- [ ] The instruction text in `docs/clients.md` (made-up project names), and the tool descriptions.
- [ ] Update Slice 5's scope line and the root `CLAUDE.md` rule.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`.
- The owner, after adding the instruction: a claude.ai chat shows on the board with its goal within
  a minute of starting, and the usage page shows a "Claude chat" row instead of all of it in "not
  explained".
