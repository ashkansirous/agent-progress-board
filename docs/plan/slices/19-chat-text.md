### Slice 19 — The owner can get the chat instruction text without a token

*Built 2026-11-17, merged as PR #110 (b99577b), not yet verified on the deployed board.*

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

- [x] Show `SERVER_INSTRUCTIONS` on the board page behind the Access check (a "Set up a chat" panel with a Copy
  button), read from the same constant, never a hand copy (CLAUDE.md, Slice 18 rule).
- [x] `docs/clients.md` *Claude chat* points at that panel; `unverified.md` Slice 16 `**You:**` line follows.
- [x] Verify: an e2e test opens the panel and the copied text equals `SERVER_INSTRUCTIONS`.

## Built

`GET /api/chat-text` (`src/api/chatText.ts`) sits behind the same Access check in `src/api/router.ts` and returns
`{text: SERVER_INSTRUCTIONS, preface: CHAT_PREFACE}` with `Cache-Control: no-store`. The page `#/setup` ("Set up a
chat", `web/src/SetupPage.tsx`, `web/src/setup.css`) has a Header link and Copy buttons for the text and for the
preface line. `docs/clients.md` "Making every chat report" points at the panel. Tests: `test/chatTextRoute.test.ts`
(Access, 403 with no token or wrong audience, 405 on POST, no-store) and `e2e/setup.spec.ts` (copied text equals
`SERVER_INSTRUCTIONS`, preface copy, loading state, 503 with Retry, bad body, refused clipboard).

*Changed while building:* no design mock covers the panel; layout and EN/DE copy are the builder's, reusing existing
tokens; the owner may restyle. The "build this or first try a new chat" question is settled by the owner's 2026-11-17
answer in the planning note above: build it.

## From review

Applied from `reviews/pr-110-high.md`: #1, #2, #3, #6, #7. From `reviews/pr-110-medium.md`: #3, #4, #6.

- Skipped #4 (`reviews/pr-110-high.md`): "Panel visual values come from no file in docs/design/." - the design has no setup panel; values reuse the existing state-card styles, no mock to read.
- Skipped #5 (`reviews/pr-110-high.md`): "header link is a tiny touch target." - low severity, not in the triaged set.
- Skipped #1 (`reviews/pr-110-medium.md`): "fetchChatText re-implements fetch/timeout/error mapping from web/src/api.ts and throws a bare number instead of LoadError." - low severity, works and is tested; not in the triaged set.
- Skipped #2 (`reviews/pr-110-medium.md`): "CHAT_TEXT_URL duplicates CHAT_TEXT_PATH from src/api/chatText.ts." - low severity, the e2e test fails if the path drifts; not in the triaged set.
- Skipped #5 (`reviews/pr-110-medium.md`): "link added to header with no phone-layout handling." - low severity, not in the triaged set.
- Skipped #7 (`reviews/pr-110-medium.md`): "Blank page up to 500 ms on Retry (failed card removed, loading renders nothing)." - repo rule shows a loading state only for waits over 500 ms.
- Skipped #8 (`reviews/pr-110-high.md`): "Guide gives `<board address>/#/setup` placeholder; owner step lacks the full address." - the public repo cannot hold the hostname (CLAUDE.md, Public repo rule).
- Skipped #1 (`reviews/pr-110-check-medium.md`): "CHAT_TEXT_URL duplicates CHAT_TEXT_PATH from src/api/chatText.ts" - low, check pass converged; follow-up.
- Skipped #2 (`reviews/pr-110-check-medium.md`): "non-JSON 200 (Access login HTML) throws SyntaxError" - low, check pass converged; follow-up.
- Skipped #3 (`reviews/pr-110-check-medium.md`): "copy-failed note says select text, but preface is a plain paragraph" - low, check pass converged; follow-up.
- Skipped #4 (`reviews/pr-110-check-medium.md`): "missing spaces" in `web/src/SetupPage.tsx` and the test import line - trivial, check pass converged; follow-up.
- Skipped #5 (`reviews/pr-110-check-medium.md`): "two CopyButtons keep separate state" - trivial, check pass converged; follow-up.
- Skipped #6 (`reviews/pr-110-check-medium.md`): "HEAD handled like GET; chatTextResponse is a thin wrapper" - trivial, check pass converged; follow-up.

#### For CLAUDE.md (lifted 2026-11-17)

- The chat instruction text reaches the owner only through `GET /api/chat-text` behind the Access check
  (`src/api/chatText.ts`), read from `SERVER_INSTRUCTIONS` and `CHAT_PREFACE`; never a hand copy in `web/` or docs
  (Slice 19: docs/plan/slices/19-chat-text.md).

#### Not yet verified

- On the deployed board, open the panel (`#/setup`), copy, paste into claude.ai Instructions and see a chat report.
