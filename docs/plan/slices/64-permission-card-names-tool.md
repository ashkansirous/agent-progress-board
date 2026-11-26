### Slice 64 — A permission-prompt card names the tool and command

*Planned 2026-11-26 by the feedback loop of night 2026-11-25-1729 (note `docs/plan/notes/2026-11-25-1729-feedback-loop.md`),
from Slice 27's two follow-ups that had no slice.*

**Product:** agent-progress-board.

*Plan-cleanup check 2026-11-26: keep open. Item 2 is already built on `origin/main` (ticked below). Item 3 is not this
slice's work (sync-docs, not the permission card) and moved to Slice 66. Item 1 is the slice's own work and is still
open: `cardText`/`toolText` in `plugin/scripts/hooks/waiting-card.mjs` already build "Allow <tool>: <command>?" when the
transcript tail holds a pending tool_use, yet the live card of 2026-11-26 said only "Claude needs your permission", so the
real payload and transcript must be recorded to see why the tool is missing.*

**Touches:** `plugin/scripts/` (the Notification hook and its transcript reader), `src/mcp/tools.ts` and `src/mcp/schemas.ts`
(`ask_human`), `src/mcp/instructions.ts` with the mirrored block in `plugin/skills/agent-board/SKILL.md`, their tests

## Why

The live check of 2026-11-26 failed: a real permission prompt opened a waiting card whose only text was "Claude needs
your permission", with no tool and no command (Slice 27 file, *Follow-up (not built, live check 2026-11-26: failed)*).
The owner cannot tell from the card what is being asked. Separately, `ask_human` cannot set `needs_you` (Slice 27 file,
*Follow-up (not built, feedback loop 2026-11-17-2023)*).

## Work

- [ ] **1.** Find where the tool name and its command come from for a permission prompt (the Notification payload, or
  the transcript tail the hook reads with `readTail`, 128 KB). Record one real Notification payload as a test fixture
  (no owner data in it) and make the card's `needs_you` name the tool and its command (cut to the field limit).
- [x] **2.** (Done, checked 2026-11-26: `askHumanShape` in `src/mcp/schemas.ts` has `needs_you` and `links`; the
  `ask_human` description and `src/mcp/instructions.ts` line 31 say so; `test/mcp.test.ts` calls it with `needs_you`.)
  `ask_human` takes `needs_you` and `links` like `report_progress`, or its description tells the client to use
  `report_progress` for a question; the rules text in `src/mcp/instructions.ts` and the SKILL.md copy say which.

- [moved 2026-11-26 to Slice 66, "An empty status table must not close doc-synced items"; still true on
  `origin/main`: `sync-docs.mjs` line ~946 sends an empty snapshot when the table is header-only] **3.** (Feedback loop pass 2.) When plan.md's status table has no open rows (the last row moved to
  `docs/plan/notes/slices-done.md`), `plugin/scripts/sync-docs.mjs` sends an empty snapshot and closes the project's
  doc-synced items (night 2026-11-25-1729: closed 73, created 72, then closed 84 / created 71 earlier). An empty table
  with slice files present must not close them; read what was closed with `list_synced` first. Test: an empty table
  closes nothing.

## Verify

- A plugin test replays the recorded payload and the card's `needs_you` names the tool and the command.
- An MCP test asks through `ask_human` and the card shows the question.
- Live (`[session]` in `docs/plan/unverified.md`): after the plugin update reaches the installed copy, a real permission
  prompt's card names the tool.
