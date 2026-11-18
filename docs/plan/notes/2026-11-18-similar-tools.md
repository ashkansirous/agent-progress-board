# Similar tools and three ideas to check (2026-11-18)

The owner asked for a survey of open-source and commercial tools close to this board, then (same day) asked to add
the three ideas it produced to the plan as things to check. Research ran on GitHub (`gh api`), vendor docs and the
Hacker News search API on 2026-11-18; star counts are from that day.

## What we found

No tool found combines what this board does: planned slices read from repo docs merged with live agent reports on one
key, a cross-project phone board with "needs you" cards opened by hooks, and a weekly-cap cost estimate across
machines, cloud sessions and chats. The closest per area:

- Session monitors fed by Claude Code hooks: disler/claude-code-hooks-multi-agent-observability (single machine, no
  phone view), luzhiyu-econ/claude-hub (multi-machine over Tailscale, shows "waiting for reply", display only),
  hoangsonww/Claude-Code-Agent-Monitor (local, hooks + OTel).
- Answering the agent remotely: Omnara (agents connect over MCP; "ask a person" and approval tools return the answer
  to the agent; runs the agents itself), Claude Code on the web (answer from the mobile app; a session list, not a
  board), HumanLayer (not checked in depth).
- Boards agents update over MCP: Backlog.md (Markdown backlog in the repo, MCP server, local kanban page),
  claude-task-master, Shrimp Task Manager. vibe-kanban is sunsetting and Crystal is deprecated.
- Usage: ccusage (5-hour blocks), Claude-Code-Usage-Monitor (forecasts from own history), ccstatusline (weekly limit
  timer); all local to one machine. Claude Code's built-in OpenTelemetry exports token and cost metrics to any
  collector; no plan-limit metric was found on its docs page.

## Three ideas to check

Not planned yet; each needs a check before it becomes a slice.

1. **Claude Code's OpenTelemetry metrics as a usage source.** Check whether `claude_code.token.usage` and
   `claude_code.cost.usage` (docs: https://code.claude.com/docs/en/monitoring-usage) could feed `report_usage` instead
   of, or beside, the plugin's transcript-reading scripts (Slice 22), and whether that also covers cloud sessions
   without the pinned download of Slice 28. Open: can the Worker take OTLP directly, or does it need a collector;
   does it keep the per-model split the cap fit (Slice 9) needs.
2. **An answer that goes back to the agent.** Omnara's "ask a person" tool returns the human's answer to the waiting
   agent; this board only shows the question (`needs_you`, Slice 27). Check whether an answer typed on the board
   could reach the session (an MCP tool the agent polls, or a hook that reads it). This touches the read-mostly
   rule in `CLAUDE.md`, so it needs the owner's yes before any slice.
3. **A repo Markdown board as a plan source.** Backlog.md keeps tasks as Markdown files in the repo with an MCP
   server, much like this board's plan sync (Slice 23). Check whether `sync_snapshot` could read a Backlog.md folder
   as a second plan format, so repos that use it show on the board without slice files.

## How the popular ones got their stars

Hacker News launch posts (from the HN search API): Omnara 310 points (Show HN, 2025-08-12) plus a YC Launch HN;
HumanLayer 354 (Launch HN, YC F24); Backlog.md 254; Claude Code Usage Monitor 245; vibe-kanban 195; ccusage 75.
awesome-claude-code (58k stars) lists ccusage, claude-squad, ccstatusline and the disler observability repo.
X/Twitter, Reddit and YouTube were not checked.
