# Plan: agent-progress-board

One phone-friendly page that shows, per project, everything still open plus what finished in
the last 12 hours, so the owner sees at a glance what needs them. Coding agents keep it true:
state is read from each repo's plan docs, live events are pushed by agents and hooks, and both
merge on one stable key per item. The rule everything serves: **the board never blocks the
work it reports on** (reporters fail open), and **the public repo holds no private data**.

Source: the owner's phone scope "Agent Progress Board — online dashboard of work progress
across projects" (2026-11-15).

**The board exposes everything through MCP** (owner's decision at the desk, 2026-11-15): one
remote MCP endpoint is the only public contract, from Slice 1 on.

**The board is a stand-alone product** (owner, 2026-11-17, replacing "clients live in the repos that use
them"): a newcomer's Claude Code, with no background, installs and onboards itself from this repo alone.
The repo ships a Claude Code plugin (skill, hooks, reporter scripts, connection) and guides written for
Claude, both for connecting to a board and for setting up your own; every client piece moves here from the
owner's config repo. Decisions in [Slice 20](docs/plan/slices/20-plugin-connect.md); Slices 20 to 24.

## Status

| Slice | Title | Status | PR | Issue | File |
| --- | --- | --- | --- | --- | --- |
| 58 | Archive follow-ups from Slice 50's reviews | planned | | | [58](docs/plan/slices/58-archive-follow-ups.md) |
| 59 | Step and sync rule follow-ups from Slice 51's reviews | planned | | | [59](docs/plan/slices/59-step-and-sync-rule-follow-ups.md) |
| 60 | Process-key review follow-ups (from Slice 55) | planned | | | [60](docs/plan/slices/60-process-key-follow-ups.md) |
| 61 | Optimiser detector and discovery follow-ups | planned | | | [61](docs/plan/slices/61-optimiser-follow-ups.md) |
| 62 | A running step reports its cost, so tokens and context breaches show live | planned | | | [62](docs/plan/slices/62-running-step-cost.md) |
| 63 | Budget hardening: four review follow-ups from Slice 56 | planned | | | [63](docs/plan/slices/63-budget-hardening.md) |

Notes:

- [Feedback loop 2026-11-19 night 0734](docs/plan/notes/2026-11-19-0734-feedback-loop.md): what the audit of the eleventh night found.
- [Feedback loop 2026-11-19 night 0554](docs/plan/notes/2026-11-19-0554-feedback-loop.md): what the audit of the tenth night found.
- [Feedback loop 2026-11-19 night 0441](docs/plan/notes/2026-11-19-0441-feedback-loop.md): what the audit of the ninth night found.
- [Feedback loop 2026-11-19 night 0243](docs/plan/notes/2026-11-19-0243-feedback-loop.md): what the audit of the eighth night found.
- [Feedback loop 2026-11-18 night 1602](docs/plan/notes/2026-11-18-1602-feedback-loop.md): what the audit of the seventh night found.

- [Feedback loop 2026-11-17 night 2023](docs/plan/notes/2026-11-17-2023-feedback-loop.md): what the audit of the sixth night found.
- [Feedback loop 2026-11-17 night 1826](docs/plan/notes/2026-11-17-1826-feedback-loop.md): what the audit of the fifth night found.
- [Feedback loop 2026-11-17 evening](docs/plan/notes/2026-11-17-1657-feedback-loop.md): what the audit of the fourth night found.
- [Feedback loop 2026-11-17](docs/plan/notes/2026-11-17-1216-feedback-loop.md): what the audit of the third night found.
- [Finished slices](docs/plan/notes/slices-done.md): rows of built slices.
- [Feedback loop 2026-11-15](docs/plan/notes/2026-11-15-1406-feedback-loop.md): what the end-of-run audit found.
- [Design brief 2026-11-17](docs/plan/notes/2026-11-17-design-brief.md): the page redesign for Slices 13 to 15, for Claude Design.
- [Finished batches](docs/plan/notes/2026-11-17-finished-batches.md): order and deploy notes of Slices 8 to 11 and 13 to 16; all are built.
- [Feedback loop 2026-11-16](docs/plan/notes/2026-11-16-1402-feedback-loop.md): what the audit of the second night found.
- Slices 1 to 7 are built and merged and deployed; 1 is verified, 5 works in claude.ai (owner, 2026-11-16; the phone check is open), and the open checks of the rest are in `docs/plan/unverified.md` (2026-11-16).

## Decisions (from the phone scope, approved 2026-11-15)

- Separate public repo with its own MCP server; the owner's agent-config repo gets only a thin
  client (CLI, hook scripts, a skill, settings).
- Public code, private data: items live in the owner's D1 behind auth; types, colours and
  projects come from config.
- Data source is repo docs plus live events. Docs give state; agents and hooks push only live
  events (started, blocked, needs you, done).
- Build, not buy (Vikunja is the fallback if this is killed).
- Doc sync runs after every unattended agent run and whenever plan docs are mirrored; a scheduled
  sync only if repos go stale in practice.
- No notifications in v1.
- Item types (answered at the desk, 2026-11-15): **slice** = a planned slice; **waiting_for_me**
  = a step only the owner can do; **bug** = something broken in a released app (from crash logs
  or a device run); **problem** = something blocking a wave or session (failed CI, stuck agent,
  a fix that failed twice); **unplanned** = new work found during a run that has no slice yet.
  Review findings are not shown; feedback-loop items become unplanned.
- Stack: TypeScript Cloudflare Worker + D1, board UI in React served as the Worker's static
  assets. No Dockerfile or GHCR image: a Worker deploys through Cloudflare Workers Builds on
  merge to `main`, which also spends no GitHub Actions minutes.

## Outstanding work

- **Not yet tried on a device:** 93 checks across 46 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- Slices 1 to 57 are built and live (migrations 0001 to 0012 applied). Slices 49 to 55 went live with the 2026-11-25T23:53:29Z deployment. Slices 56 (PR #214) and 57 (PR #217, migration 0012) went live with the night 2026-11-25-1729 batched release: the deploy hook was called at 2026-11-26T02:37:56Z, `wrangler deployments list` (read 2026-11-26 02:49Z) shows deployments created 02:39:20Z and 02:44:51Z, and `wrangler d1 migrations list DB --remote` reads "No migrations to apply" (0012_findings.sql is in the repo). `batch-release.mjs worker-deployed` has not been run for this release yet (see Watch below).
- Live checks now due (Slices 56 and 57, released): Slice 56 `[chrome]` a step with a 1-minute test budget left running 2 minutes shows the over-budget line (needs a budgets entry in the private config); Slice 57 first weekly dry-run report. They stay in docs/plan/unverified.md.
- Slice 45 and 46 follow-ups: Slice 45's not-built items (13 #1 and #3, 14 #4 and check-3 #3, 4 #8, 7 #3) are recorded decisions with reasons in its *Found while building*, not open work. Slice 45 item 8's "NaN:00" half passed in Chrome 2026-11-19; the Reset-overlap half stays in `docs/plan/unverified.md` (live check 2026-11-26 could not run: no Chrome domain in `.claude/live-checks.local.json`). Slice 46's seven check-3 follow-ups were built or kept in Slice 47 item 8.
- `D:\tmp-mirror-stage` (two files, CLAUDE.md and plan.main.md, dated 2026-11-18, read still present 2026-11-26) is a stray folder at the drive root from night 2026-11-18-1602; every agent's delete was blocked by a safety check, so the owner deletes it (`rm -rf /d/tmp-mirror-stage` in a `!` prompt). The guard gap (`drive-root-guard.mjs` let a mirror-to-drive agent create it) is item (1) of the ClaudeSkills `plan.md` line "Feedback loop agent-progress-board night 2026-11-18-1602, tooling still to build", still open on its origin/main; the earlier "ClaudeSkills #350" label was PR #350 (merged 2026-11-19, a docs change), not a plan item, so name the plan line instead.
- Slice 29 low follow-ups (see its Follow-ups section: leaked `.stopped/` folders, writeJson temp file left on kill, held goal with no SubagentStop, takeActiveSlot label match, currentAgents delete side effect, stoppedAfterLastWrite 3 s window); all low, not built (Slice 45 also left check-3 #3 unbuilt). Check: `git grep -n removeStoppedFolder origin/main -- plugin/scripts/hooks`.
- Slice 44 low follow-ups (pr-160-check-medium.md): a line already starting `Slice N:` gets the prefix twice; `actionBar` splits the raw line before `plain()` so a bar inside bold or link text splits it; board-address links are built twice (`addressLinks`, `stepUrls`) and hidden only by `dedupeLinks`. Check: `git grep -n "ownerTitleFields\|actionBar\|stepUrls" origin/main -- plugin web`
- **Ideas to check (owner, 2026-11-18), from the survey of similar tools:** (1) Claude Code's OpenTelemetry metrics as a usage source, (2) a board answer that goes back to the waiting agent (needs the owner's yes: read-mostly rule), (3) Backlog.md folders as a second plan format for `sync_snapshot`. None is a slice yet ([note](docs/plan/notes/2026-11-18-similar-tools.md)).
- **Kept as they are (match a rule or a decision):** Slice 9 #3 and #4 (cost derived at read; an unfitted model gives null), Slice 2 pr-35-high #10 (no Cancel on the loading card; the mock draws none), Slice 14 pass-2 #6, Slice 23 med #6, med #10 and check #5, Slice 10 med #7. (Slice 21 item 11 dropped: Slice 39 allows several running steps. Slice 14 check #8 dropped: migration 0007 is applied on the live D1.)

**Watch (checked by plan-cleanup):**

- Slices 56 and 57 release: the code is already live (Worker deployments at 2026-11-26T02:39:19Z and 02:44:51Z, after the deploy hook call at 02:37:56Z; `wrangler d1 migrations list --remote` "No migrations to apply"). `node skills/run-wave/batch-release.mjs worker-deployed` is still to be run for this release; then the live Slice 56 budget check in `docs/plan/unverified.md` (a step with a 1-minute budget left running 2 minutes shows the over-budget line).
- Slice 55: when the owner's skills send process keys, read `process_stats` (MCP tool on /mcp, last 30 days) and expect review and implement keys; the two Slice 55 live checks in `docs/plan/unverified.md` settle then.
- Slice 57: first weekly optimiser dry-run report on the board (key `<project>/optimiser-report-<ISO week>`, read via `list_open` or `get_item`); after 4 weeks of reports the owner reads them, then a new slice turns `--file-findings` on by default (Slice 57 Decision 11).
- Slices 16, 18, 19: whether a claude.ai chat now opens a card. Read the board's chat cards (owner's board page, or `list_open` over MCP); when one exists, mark Slices 16, 18 and 19 live-checked. The owner's step is done ("I've updated the instructions with the 2 texts", 2026-11-18T10:54), so nothing is asked of them.

## Risks / kill criteria

- Live events and doc sync disagree often (duplicate or ghost tiles) and keys can't be made
  stable: kill the live-event path, keep doc sync only.
- The reporter adds noticeable time or failures to waves: it fails open, or it is removed.
- Scope creep into a PM tool: the board is read-mostly; edits stay in repos.
- Open-source upkeep: public but unsupported.
- Internet exposure: tokens on the API and MCP, Cloudflare Access on the UI, read-only tokens
  for anything shared.
- Repos with neither agent runs nor doc mirroring go stale: add a scheduled sync only then.

## Out of Scope

- Editing, assigning or planning work from the board; sprints, estimates, anything a PM tool does.
- Work for the owner's employer.
- Notifications in v1.
- Usage (Slices 8 and 9): cost in money, stopping or slowing agents from the board when the cap
  is close, and filling in weeks from before the first report.
- Spin-offs for later: ntfy push for new waiting_for_me items (check pricing first), a daily
  overnight digest, a read-only share link per project, the board as the cloud-offload "done"
  signal instead of polling `gh pr checks`, a summary in `_STATUS.md`, a scheduled doc sync.
- Process optimiser (Slices 52 to 57, owner 2026-11-22): the board never edits a skill or repo (it flags; gates live in
  the skills); OpenTelemetry ingest, step times for cloud sessions, a monthly cost-of-a-slice trend and aggregates kept
  past 180 days are later spin-offs.
