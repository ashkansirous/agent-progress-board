### Slice 19 — The owner can get the chat instruction text without a token

*In progress (wave 2026-11-17), draft PR.*

*Planned (owner, 2026-11-17 20:2x: "I already tried the chat and I told you it did not do anything. why are you still
waiting for me to do a new chat without changing anything"): build it; the owner is not asked to test a chat again
first.* Found by the feedback loop of night 2026-11-17-1657 ([note](../notes/2026-11-17-1657-feedback-loop.md)). When
built, add one `**You:**` line to `docs/plan/unverified.md` under this slice that names the page with the Copy button
(its full address), where to paste (https://claude.ai/settings, Your Claude, Instructions) and why (so claude.ai
chats report to the board).

**Why:** Slice 18 moved the reporting rules into `SERVER_INSTRUCTIONS` (`src/mcp/instructions.ts`) and changed
`docs/clients.md` (*Claude chat*) to "paste the text the server returns in the `initialize` result". The guide no
longer holds the text, and the owner can only read `result.instructions` with a token and a hand-made MCP call. The
owner's Slice 16 step ("paste the instruction text into claude.ai Instructions") therefore has nothing to paste
(starter session entries 2318, 2331 told the owner to paste the old text, which Slice 18 then removed).

It may not be needed at all: if a claude.ai chat already shows the server's instructions to the model (Slice 18's
open check in `docs/plan/unverified.md`), the paste step goes away. [Slice 20](20-plugin-connect.md) (planned by the
owner the same evening) already says the pasted chat instruction "stays only as a fallback"; if it is kept, this slice
is how the owner gets that fallback text, and it may fold into Slice 20 or 24's guide.

**Touches:** `web/src/**`, `src/api/**`, `docs/clients.md`, `docs/plan/unverified.md`, `e2e/**`, `test/**`

**Migrations:** none

## Work

- [ ] Show `SERVER_INSTRUCTIONS` on the board page behind the Access check (a "Set up a chat" panel with a Copy
  button), read from the same constant, never a hand copy (CLAUDE.md, Slice 18 rule).
- [ ] `docs/clients.md` *Claude chat* points at that panel; `unverified.md` Slice 16 `**You:**` line follows.
- [ ] Verify: an e2e test opens the panel and the copied text equals `SERVER_INSTRUCTIONS`.

## Open for the owner

- Build this, or first try a new chat with only the connector (Slice 18 check) and drop the slice if a card opens.
