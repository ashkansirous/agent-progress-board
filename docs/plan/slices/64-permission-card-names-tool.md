### Slice 64 — A permission-prompt card names the tool and command

*Planned 2026-11-26 by the feedback loop of night 2026-11-25-1729 (note `docs/plan/notes/2026-11-25-1729-feedback-loop.md`),
from Slice 27's two follow-ups that had no slice.*

**Product:** agent-progress-board.

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
- [ ] **2.** `ask_human` takes `needs_you` and `links` like `report_progress`, or its description tells the client to use
  `report_progress` for a question; the rules text in `src/mcp/instructions.ts` and the SKILL.md copy say which.

- [ ] **3.** (Feedback loop pass 2.) When plan.md's status table has no open rows (the last row moved to
  `docs/plan/notes/slices-done.md`), `plugin/scripts/sync-docs.mjs` sends an empty snapshot and closes the project's
  doc-synced items (night 2026-11-25-1729: closed 73, created 72, then closed 84 / created 71 earlier). An empty table
  with slice files present must not close them; read what was closed with `list_synced` first. Test: an empty table
  closes nothing.

## Verify

- A plugin test replays the recorded payload and the card's `needs_you` names the tool and the command.
- An MCP test asks through `ask_human` and the card shows the question.
- Live (`[session]` in `docs/plan/unverified.md`): after the plugin update reaches the installed copy, a real permission
  prompt's card names the tool.
