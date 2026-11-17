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

## What the plugin's hooks do on their own

The plugin installs hooks (list in the plugin repository's `docs/clients.md`). You do not repeat their work:

- **Stop:** the hook marks your card done when your reply ends, so do not call `mark_done` after every reply. If a
  background agent worked in the last 10 minutes, the hook keeps the card open ("background agents running") and shows
  each running agent as a step. While your card has an open `needs_you` question the hook leaves the card open and
  closes nothing: answer or clear the question yourself (`needs_you` null), or call `mark_done` when the work is over.
- **Your next prompt** reopens a card the Stop hook closed (and only then).
- **Waiting:** when Claude Code asks the person for input, the hook raises a "needs you" item; it closes it when the
  session goes on or stops. A session that died leaves such an item, and the next hook on the machine closes it after
  30 minutes of silence.
- **Reminder:** the hook sees your `report_progress` call with agent "session" and remembers its key, so use that one
  key for the whole session. If you have sent no goal by your second tool call of a prompt, it reminds you once.

- **Usage (option `report_usage`, on by default):** a hook sends token counts. The plan's cap percentage is a separate
  option, `read_plan_cap`, off by default: when the person turns it on, the same run reads Claude Code's own sign-in
  file (`.credentials.json`) to ask Anthropic for it. `report_usage` off stops both. You send no token numbers yourself.

What you still report yourself: the card's title and why, the steps and each change of them, a heartbeat at least
every 5 minutes while working, a question in `needs_you`, and `mark_done` when the goal is done.

## Steps only the person can do (repos with plan sync)

In a repo that keeps its plan in `docs/plan/` (see `docs/setup/plan-sync.md` in the plugin repository), every step
only the person can do (a console form, a permission, an approval, something on their own device) is written in
`docs/plan/unverified.md` in the same turn you name it, under that slice's `### Slice N: <title>` heading, as a line
that starts `- **You:**` and carries its direct link. The plan sync turns that line into a "Waiting on you" card; a
step that is only said in chat never reaches the board. A park reason that starts with "waits for", "waiting on" or "behind"
followed by an interactive session, a deploy, a merge, CI, a PR or another slice ("waits for the deploy to finish")
is work, not the person's, and no card is raised; if the reason also names the user, the owner or "you", the card stays.

## How to apply them

The rules above are the whole procedure. What they leave to you:

- **Project name.** Take it from the folder or repository you work in; keep it and the random id the same for the
  whole session.
- **Keys and projects.** Keys are `<project>/<name>`; the project is a short name of the work, the same one every
  time. Reuse a key to update a card; a new key makes a new card.
- **Never send** private data (credentials, personal details, file contents) or a number you did not read: no guessed
  token counts, no guessed percentages.
