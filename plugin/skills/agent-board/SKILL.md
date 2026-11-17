---
name: agent-board
description: Report your own work to the agent progress board (the "agent-board" MCP server) - open a session card at the start, keep its steps current, send heartbeats, mark it done, and ask the person a question through needs_you. Use at the start of every session, whenever the plan or a step changes, when a background agent is working, and when the goal is done.
---

# Reporting to the agent progress board

The board is an MCP server named `agent-board`, set up by this plugin. Its tools: `report_progress`,
`mark_done`, `ask_human`, `get_item`, `list_open`, `report_usage`, `report_cap`, `sync_snapshot`. If the tools are
missing, the plugin's board address or token is not set: tell the person to run `/plugin`, open Installed,
agent-board, Configure options, and follow https://github.com/ashkansirous/agent-progress-board/blob/main/docs/setup/connect.md (the guide is not
inside the installed plugin).

## The rules

The text between the two markers is the same text the board sends to every MCP client when it connects. A test in
the plugin's repository keeps the two equal; do not edit it here, edit `src/mcp/instructions.ts` and copy the result.

<!-- BEGIN RULES -->
This server is a progress board. Report your own work on it.

If your brief names a parent card key, you are a helper agent: report your steps on that card and open no session card. Otherwise, at the start of every session or chat, before your first answer, call report_progress once with key "<project>/session-<id>" (<project> is the project you work in, or "chats" if none; <id> is a short random id you make up, the same <project> and <id> for the whole session), project = <project>, type "unplanned", agent "session", your environment, status "in_progress", title = your goal in one line, why = what it is for, steps = your plan as a list of {label, state}, state one of "done", "active", "pending", at most one "active". Limits: 30 steps, label 80 characters, note 120; a report over a limit is refused and creates no card.

Keep the card current:
- Whenever a step changes, send the whole steps list again.
- While working, report at least every 5 minutes (report_progress with the key and status "in_progress"; a session card with no report for 15 minutes turns stale). If you cannot keep time, report at every step change and before and after a long wait, never on every tool call.
- Work you hand to a background agent keeps its step "active", with a note naming the agent, until that agent reports back.
- Call mark_done only when the goal is done and no background agent is still working. Never call it just because a reply ended.
- A question for the person goes in needs_you (and after_answer), on the same card. While it is open, repeat the same needs_you text in every report, heartbeats included (an unchanged text keeps its first-asked time; a heartbeat without it can clear the question after the card went stale). When it is answered, send needs_you null.
- Never guess token numbers; report usage only if you can read it.
<!-- END RULES -->

One session card per session: if the server's instructions already had you open one, keep that card and never open a
second.

## How to apply them

The rules above are the whole procedure. What they leave to you:

- **Project name.** Take it from the folder or repository you work in; keep it and the random id the same for the
  whole session.
- **Keys and projects.** Keys are `<project>/<name>`; the project is a short name of the work, the same one every
  time. Reuse a key to update a card; a new key makes a new card.
- **Never send** private data (credentials, personal details, file contents) or a number you did not read: no guessed
  token counts, no guessed percentages.
