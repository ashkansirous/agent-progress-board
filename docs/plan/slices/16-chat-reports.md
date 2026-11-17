### Slice 16 — Claude chat and Claude Design report to the board, and their use counts

*Built 2026-11-17 (draft PR #83, not merged), not yet verified on a real claude.ai chat. 457 unit and 215 e2e tests green.*

*Changed while building:* the write rule is `allows` in `src/domain/scope.ts` (file added to Touches); `scopeOfCaller` in `src/api/oauth/provider.ts` maps every OAuth-issued token to `Scope.Owner` (write tools except `sync_snapshot`) and unknown props to `Read`; old grants need no reconnect. Chat and Design windows are derived at read from session cards (`SESSION_WINDOWS` in `src/infrastructure/d1Repository.ts`), placed by `placeInWindows` in `src/domain/capCost.ts`, capped by `MAX_PLACE_WINDOWS`; placed rows have a null multiplier and null tokens (dash) and respect the environment filter.

*From review* (`reviews/pr-83-high.md` 10/10, `reviews/pr-83-medium.md` 8/8, `reviews/pr-83-check-medium.md` 8/8, `reviews/pr-83-check-2-medium.md` 10/10 read; every finding not listed below went to the fixer):
- Skipped #2 and #3 (`reviews/pr-83-high.md`): "Every existing OAuth grant is upgraded from read-only to write with no new consent" - the owner's own passphrase grant writes by design, user: "how the fuck did you go from that to we intentionally build it in a way that they wont be able to report?!" (Why above).
- Skipped #4 (`reviews/pr-83-high.md`): "SESSION_WINDOWS takes MIN(at) to MAX(at) over all non-stale events of a card" - the Design defines a window as the card's first to last report.
- Skipped #10 (`reviews/pr-83-high.md`): "nothing records that placeInWindows / SESSION_WINDOWS is the one place chat growth is placed" - the rule is lifted into CLAUDE.md through the block below.
- Skipped #1 (`reviews/pr-83-medium.md`): "every provider-issued OAuth token gets Owner scope whatever consent granted" - same point as high #2. The stored `mcp:read` scope string is kept so the claude.ai handshake is unchanged (follow-up below).
- Skipped #1 and #10 (`reviews/pr-83-check-2-medium.md`): "Every provider token gets Owner scope" - same point as high #2.
- Skipped #4 and #5 (`reviews/pr-83-medium.md`): "placeInWindows assumes normalised UTC ISO strings" and "placement is a time-share heuristic" - low; every stored time is UTC ISO, and the time share is the Design.
- Skipped #3, #4, #5, #7 (`reviews/pr-83-check-medium.md`): "SQL lower(trim()) is ASCII/space-only", "boundedWindows/placeInWindows compare ISO strings", "SESSION_WINDOWS 500-card cap counts zero-length windows", "overlapping windows split pro rata to raw overlap" - low; follow-ups below.

*Follow-ups from review* (none is a crash, data-loss, security, privacy or loading-state finding):
- `reviews/pr-83-check-2-medium.md` #3 (and check #3): SQL `lower(trim())` and JS `environmentIdentity` differ on non-ASCII and tab or NBSP.
- `reviews/pr-83-check-2-medium.md` #4: the window LIMIT counts cards, so busy environments can crowd out older chat windows.
- `reviews/pr-83-check-2-medium.md` #5 and #6: growth under 0.05 points is dropped from the list but still left out of the residual, so totals may not add up.
- `reviews/pr-83-check-2-medium.md` #7 (and check #4): windows compared as strings in `boundedWindows`, parsed in `placeInWindows`.
- `reviews/pr-83-check-2-medium.md` #2, #8, #9 and check #5, #7: the window query runs when the fit is null; O(stretches x windows); `isPlaced` inferred, no flag; zero-length windows count against the cap; overlap split untested for 3 or more.
- The OAuth grant still stores the scope string `mcp:read` while the token can write (check-2 #1, #10): rename the scope when the connector handshake is next touched.

**Touches:** `src/api/oauth/**`, `src/api/auth.ts`, `src/mcp/tools.ts`, `src/mcp/schemas.ts`, `src/domain/capCost.ts`,
`src/domain/usage.ts`, `src/application/board.ts`, `test/**`, `docs/clients.md`, `README.md`, `CLAUDE.md`,
`docs/plan/slices/05-remote-mcp.md`, `docs/plan/slices/16-chat-reports.md`, `src/application/usage.ts`,
`src/application/ports.ts`, `src/infrastructure/d1Repository.ts`, `src/api/usageDto.ts`, `src/config.ts`,
`config/board.example.json`, `web/**`, `e2e/**`, `src/domain/scope.ts` (widened at build: the write rule)

**Migrations:** none.

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

#### Design (coordinator, at claim, wave 2026-11-17)

- **Who may write.** Every token the OAuth provider issued (a claude.ai sign-in) gets the owner's
  write tools except `sync_snapshot`, whatever scope string its grant stored, so grants made before
  this slice need no reconnect. The bearer write token keeps every tool, the read token stays
  read-only. One place decides it: the scope mapping in `src/api/oauth/provider.ts`; `tools.ts` only
  reads the scope. The consent page text (`src/api/oauth/page.ts`) says the connector can write.
- **A chat window is a report, not a new table.** A chat or Design session reports with
  `report_progress` (a session item carrying `environment`); its window is that item's first report
  to its last report (or `mark_done`), read from the items rows that exist today. No migration, no
  stored window, no stored weight (root `CLAUDE.md`: derived at read).
- **The fit.** In `src/domain/capCost.ts`, cap growth between two cap readings that the token
  reports do not explain, and that falls inside one or more reported windows, is put against those
  windows' environments (split evenly when windows overlap, pro rata to the overlap in time);
  outside every window it stays "not explained". Pure function, unit tests: no window, one window,
  two overlapping windows; the timing test in `test/capCost.test.ts` stays inside its bound.
- **Environment from OAuth callers.** Free text as today (`schemas.ts`); a session report from an
  OAuth caller with no environment is stored as given (nothing invented); the tool descriptions say
  to send "Claude chat" or "Claude Design".

#### Work

- [x] Check first and write the answers here, with sources: can a claude.ai chat or a Claude Design
  session call a custom connector's tools; can either read its own token use or cap percentage; where
  in claude.ai a standing instruction for every chat lives (its exact page address, for the owner's
  step).
  Answers (docs check, 2026-11-17):
  1. A claude.ai chat can call a custom remote MCP connector's tools ("available on Claude, Cowork,
     and Claude Desktop" on Free to Enterprise plans; Free allows one custom connector). Source:
     https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
  2. Claude Design and custom connectors: **unproven**. https://claude.com/design lists only built-in
     connectors and the connectors collection does not mention Design. The instruction text is written
     for chat; the Design path stays in Not yet verified.
  3. A chat reading its own token use or limit percentage: no tool or API found; Settings > Usage shows
     it to the person only. Source: https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
     So chat reports windows (start and end of work), and `report_usage` only if it somehow has numbers.
  4. Standing instruction for every chat: Settings, "Your Claude", Instructions (older layout: Account,
     "Instructions for Claude"). Source: https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features.
     Page: https://claude.ai/settings (the sub-path is not documented).
- [x] OAuth callers get the write tools above; tests for a write through an OAuth grant, a refused
  `sync_snapshot`, and the bearer paths unchanged. Find out whether existing grants carry the old
  scope; if they do, say so and give the owner the reconnect step with its link.
  Existing grants: no reconnect. `completeAuthorization` stored `props: { kind: "owner" }` and the old
  code ignored the grant's scope string; `scopeOfCaller` maps any token without a static `scope` prop
  to `Scope.Owner`, so old and new grants behave alike. (The connector's cached tool descriptions
  refresh when claude.ai reloads the connector; access does not depend on it.)
- [x] Environment on reports from OAuth callers; tests. (`report_progress`, `report_usage` already
  took free-text `environment`; the schema text and tool descriptions now name "Claude chat" and
  "Claude Design"; a session report with none is stored as given, tested.)
- [x] The fit puts unexplained growth inside reported chat or Design windows against their
  environment; tests with a window, without one, and two overlapping windows; the timing test in
  `test/capCost.test.ts` stays inside its bound. (`placeInWindows` in `src/domain/capCost.ts`; the
  windows are session cards' first to last report, `sessionWindowsFrom`; an environment that also
  sends token samples is fitted normally and gets no window. The placed points show as that
  environment's `cap_points` in `cap_cost.environments` with 0 tokens, and leave "not explained".)
- [x] The instruction text in `docs/clients.md` (made-up project names), and the tool descriptions.
- [x] Update Slice 5's scope line and the root `CLAUDE.md` rule.

#### Not yet verified

- Claude Design calling the connector: unproven (see the first Work item). The owner tries the
  instruction text in a Design session once.
- A real claude.ai chat reporting through the connector and the usage page's "Claude chat" row.
- The owner adds the instruction text from `docs/clients.md` at https://claude.ai/settings (Your Claude, Instructions).
- Claude Design and custom connectors are unproven in the docs (`reviews/s16-research.md`).

#### For CLAUDE.md

- OAuth callers write: every token the OAuth provider issued gets the write tools except `sync_snapshot`, decided only by `scopeOfCaller` in `src/api/oauth/provider.ts` and `allows` in `src/domain/scope.ts`; replaces "OAuth callers are read-only" (Slice 16: docs/plan/slices/16-chat-reports.md).
- Chat and Design growth is placed only in `placeInWindows` in `src/domain/capCost.ts`; the windows are derived at read from session cards, never stored (Slice 16: docs/plan/slices/16-chat-reports.md).

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`.
- The owner, after adding the instruction: a claude.ai chat shows on the board with its goal within
  a minute of starting, and the usage page shows a "Claude chat" row instead of all of it in "not
  explained".
