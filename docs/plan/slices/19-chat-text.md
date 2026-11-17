### Slice 19 — The owner can get the chat instruction text without a token

*Parked: feedback loop, waits for the user.* Found by the feedback loop of night 2026-11-17-1657
([note](../notes/2026-11-17-1657-feedback-loop.md)); not to be built by a night until the owner says so.

**Why:** Slice 18 moved the reporting rules into `SERVER_INSTRUCTIONS` (`src/mcp/instructions.ts`) and changed
`docs/clients.md` (*Claude chat*) to "paste the text the server returns in the `initialize` result". The guide no
longer holds the text, and the owner can only read `result.instructions` with a token and a hand-made MCP call. The
owner's Slice 16 step ("paste the instruction text into claude.ai Instructions") therefore has nothing to paste
(starter session entries 2318, 2331 told the owner to paste the old text, which Slice 18 then removed).

It may not be needed at all: if a claude.ai chat already shows the server's instructions to the model (Slice 18's
open check in `docs/plan/unverified.md`), the paste step goes away.

**Touches:** `web/src/**`, `src/api/**`, `docs/clients.md`, `docs/plan/unverified.md`, `e2e/**`, `test/**`

**Migrations:** none

## Work

- [ ] Show `SERVER_INSTRUCTIONS` on the board page behind the Access check (a "Set up a chat" panel with a Copy
  button), read from the same constant, never a hand copy (CLAUDE.md, Slice 18 rule).
- [ ] `docs/clients.md` *Claude chat* points at that panel; `unverified.md` Slice 16 `**You:**` line follows.
- [ ] Verify: an e2e test opens the panel and the copied text equals `SERVER_INSTRUCTIONS`.

## Open for the owner

- Build this, or first try a new chat with only the connector (Slice 18 check) and drop the slice if a card opens.
