### Slice 18 — Every AI that connects to the board is told how to report

*Built 2026-11-17, merged as PR #94 (f325d9f).*

*Planned: the owner, 2026-11-17: "the fix you did for ClaudeSkills, is a part of what should be written for the
coding agents and AIs when they use the board via mcp. it should be in the setup", then "do we even have a proper
setup for AI agents to use the board?".* Small code change plus the client guide.

**Touches:** `src/mcp/handler.ts`, `src/mcp/instructions.ts`, `test/mcpInstructions.test.ts`, `docs/clients.md`, `docs/plan/slices/18-agent-setup.md`

**Migrations:** none

#### Why

- The board's MCP server sends no `instructions` when a client connects: `new McpServer({ name, version })` in
  `src/mcp/handler.ts` gets no options. An AI that adds the connector (a claude.ai chat, a Claude Code session on
  another machine, a cloud session) gets only the tool descriptions, and is never told when to open a card, keep
  it current or close it.
- The reporting rules live only in `docs/clients.md` (675 lines, which a connected AI never reads) and in the
  owner's own hooks. So the owner had to paste a separate instruction into claude.ai, and the owner's two short chats on
  2026-11-17 reported nothing.
- The rules miss the case found that day: a session that hands work to background agents (translation,
  illustration) had its card closed at every turn end, and the steps never showed that work. `docs/clients.md`
  *Steps* says only "Helpers count under their parent's step", and *What to report and when* says "A session
  finished: `mark_done`" without saying what finished means.

#### Work

- [x] **Server instructions.** One text constant in `src/mcp/instructions.ts`, passed as the `instructions` option
  of `McpServer` (check the option's name and shape in the installed `@modelcontextprotocol/sdk` through context7
  first). At most about 2,000 characters, no project names (public repo). It says: at the start of every
  session or chat, before the first answer, call `report_progress` once on `<project>/session-<id>` with type
  `unplanned`, agent `session`, environment, status `in_progress`, title = the goal, why, steps = the plan with
  one `active`; send the whole steps list again whenever a step changes; heartbeat at least every 5 minutes while
  working; work handed to a background agent keeps its step `active` (note naming the agent) until that agent
  reports back; `mark_done` only when the goal is done and no background agent is still working, never at the end
  of a reply; a question for the person goes in `needs_you`; never guess token numbers. Verify: a test sends
  `initialize` to `/mcp` and finds the text in `result.instructions`.
- [x] **Client guide.** `docs/clients.md` gets a short *Setup for an AI agent* section near the top: add the
  connector (Claude Code: the MCP server entry; claude.ai: the OAuth connector), and that the server's own
  instructions carry the reporting rules, so no pasted text is needed where the client shows server instructions
  to the model. *Steps* and *What to report and when* get the background-agent rule above. The pasted chat
  instruction stays, marked as needed only where the client ignores server instructions. Verify: the sections
  read as above.

#### Not yet verified

- Whether a claude.ai chat shows the server's instructions to the model. Check: a new chat with only the connector
  (no pasted text) opens a `my-chats` card. If it does, the owner's pasted instruction can be removed.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.
- Run: lint and typecheck clean; `npm test` 469 passed; `npm run test:e2e` 239 passed, 3 skipped (run before the last
  review fix; that fix touched the instructions text only, and `npm test` was rerun after it: 469 passed).

#### Changed while building

- `SERVER_INSTRUCTIONS` in `src/mcp/instructions.ts` is built from the domain constants (`ItemType`, `SESSION_AGENT`,
  `SESSION_STALE_AFTER_MINUTES`, the step limits), not literals. It is passed as the `instructions` option of
  `McpServer` (SDK 1.32.2, checked through context7 `/modelcontextprotocol/typescript-sdk`); a test enforces under
  2,000 characters.
- `docs/clients.md` *Setup for an AI agent*: a pasted chat text is a copy of `initialize` `result.instructions`.
  The heartbeat is the key plus status `in_progress`; the background-agent rule and the `mark_done` rule are written in.

#### For CLAUDE.md (lifted 2026-11-17)

- The reporting rules an MCP client receives are one constant, `SERVER_INSTRUCTIONS` in `src/mcp/instructions.ts`,
  built from the domain constants; `docs/clients.md` tells chat users to copy it from the `initialize` result, never a
  hand copy (Slice 18: docs/plan/slices/18-agent-setup.md).

#### From review

review read: `reviews/pr-94-high.md` findings 8/8, `reviews/pr-94-medium.md` 8/8, `reviews/pr-94-check-medium.md` 7/7, `reviews/pr-94-check-2-medium.md` 4/4.

- `pr-94-high.md`: applied #1-5, 7, 8.
- `pr-94-medium.md`: applied #1-6.
- `pr-94-check-medium.md`: applied #1, 2, 3, 4, 7.
- `pr-94-check-2-medium.md`: applied #1 (the heartbeat line in `docs/clients.md`).
- Skipped #6 (`reviews/pr-94-high.md`): "test only checks three substrings, not the facts" - the test already asserts equality with the `SERVER_INSTRUCTIONS` constant, which is built from the domain constants (the coordinator's reason, wave 2 entry 145; the earlier wording here was the docs agent's own, corrected by the feedback loop of night 2026-11-17-1657).
- Skipped #7 (`reviews/pr-94-medium.md`): "Test only checks a few words appear" - low value; the step-state names are now asserted and the text is short.
- Skipped #5 (`reviews/pr-94-check-medium.md`): "no list of which clients do; stateless tools/call without initialize gets none" - which clients show instructions is outside this repo; the text already says to paste where the client ignores them and that plain POST gets none.
- Skipped #6 (`reviews/pr-94-check-medium.md`): "tests only assert 5<15 and a few words" - low value; the heartbeat and stale numbers are asserted and the limits now come from the domain constants.
- Skipped #8 (`reviews/pr-94-medium.md`): "Work items ticked [x] before the gate finished; no unverified.md entry" - update-docs records verification state after the gate.

#### Follow-ups

From `reviews/pr-94-check-2-medium.md`, after the second check pass, not reopened in this slice:

- #2: a reworded `needs_you` on a heartbeat restarts `needs_you_at` (`withAsked`); the text could say to send it only on an `in_progress` report, verbatim.
- #3: the helper rule says "report your steps on that card" without saying steps replace the whole list; name `agent_key` or say not to send steps.
- #4: a chat that goes quiet cannot heartbeat, so its session card expires (15 minutes) while the person reads; the text has no note on this or on skipping the card for trivial chats.
