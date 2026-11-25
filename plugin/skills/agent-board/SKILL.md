---
name: agent-board
description: Report your own work to the agent progress board (the "agent-board" MCP server) - open a task card when a task that delivers something starts (not for a plain chat), keep its steps current, send heartbeats, mark it done, and ask the person a question through needs_you. Use when such a task starts, whenever the plan or a step changes, when a background agent is working, and when the goal is done.
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

If your brief names a parent card key, you are a helper agent: report your steps on that card and open no session card. Otherwise a card is a task with an outcome; a plain chat, a question answered in the chat and an orchestrator (a wave runner; its slices have their own cards) get none. When you start a task that delivers something (a slice: code merged; refining ideas: a plan), call report_progress once, before the work. For a planned slice's work: key "<project>/slice-<N>", with no type and no agent (the slice's card already exists from the plan sync; the outcome and steps go on it; if the report is refused because no such card exists, report a task card instead). For any other task: key "<project>/task-<id>" (<id> is a short random id, the same for the whole task), type "unplanned", agent "session". Both: project = <project> (the project you work in, or "chats" if none), your environment, status "in_progress", title = the task in one line, outcome = what it delivers (up to 200 characters, e.g. "Code merged to main"), why = what it is for, steps = your plan as a list of {label, state}, state one of "done", "active", "pending". Limits: 200 steps in all, 4 levels, label 80 characters, note 120; a report over a limit is refused and creates no card.

Keep the card current:
- Steps form a tree: a step may have children, and several steps may be "active" at once. An optional id keeps a step stable across reports.
- Whenever a step changes, send the whole steps list again; it replaces the stored list, so a list with fewer steps drops the others (a step sent without children keeps its stored ones).
- Give a step that has children or that a helper reports under a short stable id (at most 80 characters), the same in every report; made-up ids follow the label and change with it.
- A helper sends its own steps with under_step = the id its parent told it; they replace only that step's children. Never send it a flat list.
- While working, report at least every 5 minutes (report_progress with the key and status "in_progress"; a session card with no report for 15 minutes turns stale). If you cannot keep time, report at every step change and before and after a long wait, never on every tool call.
- Work you hand to a background agent keeps its step "active", with a note naming the agent, until that agent reports back.
- Call mark_done only when the goal is done and no background agent is still working. Never call it just because a reply ended.
- There is no delete: archive_item hides an item and everything under it, keeps them 30 days (get_item with include_archived reads them), then removes them. A report on an archived key is refused (upsert_item restores it). apply_batch changes up to 200 items a call; list_synced shows what a plan sync holds.
- A question for the person goes in needs_you (and after_answer), on the same card: the question, its options and what each does, the work it belongs to (slice, task) in the title, and a link to where the person acts; never a card that only says "waiting". While it is open, repeat the same needs_you text in every report, heartbeats included (an unchanged text keeps its first-asked time; a report without it can clear the question). When it is answered, send needs_you null. A chat that cannot use report_progress asks with ask_human, giving needs_you (the question) and links on its own waiting_for_me item. A chat that is waiting on the person sends no heartbeat; its card turns stale after 15 minutes, and that is expected.
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
- **Reminder:** the hook sees your own-card `report_progress` call (agent "session", or a `<project>/slice-<N>` key with
  no agent) and remembers its key and kind; a later own-card report moves it to the new card. A slice card is never
  closed, marked done or staled by a hook (doc sync owns its status); the hooks still add helper-agent steps to it. If you have sent no goal by your second tool call of a prompt, it reminds you once per
  prompt to report the task if the prompt started one with an outcome.
- **Orchestrators:** a session that only runs other work (a wave runner) has no card of its own: run
  `node <plugin>/scripts/report-progress.mjs --orchestrator` once. It sends nothing; it marks the session, and the hooks
  then open no card and send no reminder for it. The slices it builds have their own cards.

- **Usage (option `report_usage`, on by default):** a hook sends token counts. The plan's cap percentage is a separate
  option, `read_plan_cap`, off by default: when the person turns it on, the same run reads Claude Code's own sign-in
  file (`.credentials.json`) to ask Anthropic for it, and sends the percentage, the plan's name and the window reset times. `report_usage` off stops both. You send no token numbers yourself.

What you still report yourself: the card's title and why, the steps and each change of them, a heartbeat at least
every 5 minutes while working, a question in `needs_you`, and `mark_done` when the goal is done.

## Steps only the person can do (repos with plan sync)

In a repo that keeps its plan in `docs/plan/` (see `docs/setup/plan-sync.md` in the plugin repository), every step
only the person can do (a console form, a permission, an approval, something on their own device) is written in
`docs/plan/unverified.md` in the same turn you name it, under that slice's `### Slice N: <title>` heading, as a line
that starts `- **You:**` and carries its direct link. Write it as `- **You:** <short action> | <steps>`: the short
action is the card title (the sync adds `Slice <N>: ` in front and cuts the title at 80 characters), and the steps,
with the direct link, are its description. A line with no `|` is all title. The plan sync turns that line into a
"Waiting on you" card; a step that is only said in chat never reaches the board. A park reason that starts with "waits for", "waiting on" or "behind"
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
