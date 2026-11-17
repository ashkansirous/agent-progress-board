### Slice 18 — Every AI that connects to the board is told how to report

*In progress (wave 2026-11-17), draft PR.*

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

- [ ] **Server instructions.** One text constant in `src/mcp/instructions.ts`, passed as the `instructions` option
  of `McpServer` (check the option's name and shape in the installed `@modelcontextprotocol/sdk` through context7
  first). At most about 2,000 characters, no project names (public repo). It says: at the start of every
  session or chat, before the first answer, call `report_progress` once on `<project>/session-<id>` with type
  `unplanned`, agent `session`, environment, status `in_progress`, title = the goal, why, steps = the plan with
  one `active`; send the whole steps list again whenever a step changes; heartbeat at least every 5 minutes while
  working; work handed to a background agent keeps its step `active` (note naming the agent) until that agent
  reports back; `mark_done` only when the goal is done and no background agent is still working, never at the end
  of a reply; a question for the person goes in `needs_you`; never guess token numbers. Verify: a test sends
  `initialize` to `/mcp` and finds the text in `result.instructions`.
- [ ] **Client guide.** `docs/clients.md` gets a short *Setup for an AI agent* section near the top: add the
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
