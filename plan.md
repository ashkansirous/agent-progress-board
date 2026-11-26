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
| 58 | Archive follow-ups from Slice 50's reviews | planned (not started; 7 own-work items, all still hold on origin/main) | | | [58](docs/plan/slices/58-archive-follow-ups.md) |
| 59 | Step and sync rule follow-ups from Slice 51's reviews | planned (not started; 9 own-work items open, none waits on an outside event) | | | [59](docs/plan/slices/59-step-and-sync-rule-follow-ups.md) |
| 60 | Process-key review follow-ups (from Slice 55) | planned (4 own-work items open, none started) | | | [60](docs/plan/slices/60-process-key-follow-ups.md) |
| 61 | Optimiser detector and discovery follow-ups | planned (7 optimiser follow-ups, none built; checked 2026-11-26) | | | [61](docs/plan/slices/61-optimiser-follow-ups.md) |
| 62 | A running step reports its cost, so tokens and context breaches show live | planned (not started; all three work items open, checked 2026-11-26) | | | [62](docs/plan/slices/62-running-step-cost.md) |
| 63 | Budget hardening: four review follow-ups from Slice 56 | planned (all 4 items still open on origin/main 2026-11-26) | | | [63](docs/plan/slices/63-budget-hardening.md) |
| 64 | A permission-prompt card names the tool and command | planned (item 1 open: live card of 2026-11-26 lacked the tool though cardText builds it; item 2 done, item 3 moved to Slice 66) | | | [64](docs/plan/slices/64-permission-card-names-tool.md) || 65 | Task-row and step-cost review follow-ups (from Slices 53 and 54) | planned (items 1-6 and 8 unbuilt; item 7 stat-failure part already built) | | | [65](docs/plan/slices/65-step-and-cost-follow-ups.md) |
| 66 | An empty status table must not close doc-synced items | planned | | | [66](docs/plan/slices/66-empty-table-keeps-synced-items.md) |

Notes:

- [Feedback loop 2026-11-19 night 0734](docs/plan/notes/2026-11-19-0734-feedback-loop.md): what the audit of the eleventh night found.
- [Feedback loop 2026-11-19 night 0554](docs/plan/notes/2026-11-19-0554-feedback-loop.md): what the audit of the tenth night found.
- [Feedback loop 2026-11-19 night 0441](docs/plan/notes/2026-11-19-0441-feedback-loop.md): what the audit of the ninth night found.
- [Feedback loop 2026-11-19 night 0243](docs/plan/notes/2026-11-19-0243-feedback-loop.md): what the audit of the eighth night found.
- [Feedback loop 2026-11-18 night 1602](docs/plan/notes/2026-11-18-1602-feedback-loop.md): what the audit of the seventh night found.

- [Feedback loop 2026-11-17 night 2023](docs/plan/notes/2026-11-17-2023-feedback-loop.md): what the audit of the sixth night found.
- [Feedback loop 2026-11-17 night 1826](docs/plan/notes/2026-11-17-1826-feedback-loop.md): what the audit of the fifth night found.
- [Feedback loop 2026-11-25-1729](docs/plan/notes/2026-11-25-1729-feedback-loop.md): what the audit of night 2026-11-25-1729 found (Slices 64, 65 planned).
- [Feedback loop 2026-11-17 evening](docs/plan/notes/2026-11-17-1657-feedback-loop.md): what the audit of the fourth night found.
- [Feedback loop 2026-11-17](docs/plan/notes/2026-11-17-1216-feedback-loop.md): what the audit of the third night found.
- [Finished slices](docs/plan/notes/slices-done.md): rows of built slices.
- [Review findings kept as they are](docs/plan/notes/2026-11-26-kept-review-findings.md): findings that match a rule or a decision (moved from Outstanding work, 2026-11-26).
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

- **Not yet tried on a device:** 92 checks across 45 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- Slices 1 to 57 are built and live (migrations 0001 to 0012; `wrangler d1 migrations list DB --remote` read 2026-11-26 21:41Z: "No migrations to apply"). Slices 58 to 66 are planned follow-up slices. Slices 56 and 57 went live with the night 2026-11-25-1729 release (deploy hook 2026-11-26T02:37:56Z; deployments 02:39Z and 02:44Z; later deployments 05:58Z and 10:04Z; no `src`, `web`, `migrations` or `config` change on origin/main since 02:45Z). The release is closed out: `batch-release.json` has no `workerNotDeployed` or `workerHook` key, so `worker-deployed` has nothing to clear and need not be run.
- Live checks due for Slices 56 and 57 stay in docs/plan/unverified.md: Slice 56 `[chrome]` budget breach line (needs a budgets entry in the private config; no Chrome domain in `.claude/live-checks.local.json`); Slice 57 first dry-run report (read 2026-11-26 21:41Z: `list_open` shows no `optimiser-report-*` card; the plugin cache now holds 7318d16e2360 with `scripts/optimiser/`, but no run has reported).
- Owner step: delete the stray folder `D:\tmp-mirror-stage` (CLAUDE.md and plan.main.md, 2026-11-18; read still present 2026-11-26) with `rm -rf /d/tmp-mirror-stage` in a `!` prompt; every agent delete was blocked. The guard gap is closed: `drive-root-guard.mjs` is on ClaudeSkills origin/main (a34af9b, bfd137e) and item (1) of its plan line "Feedback loop agent-progress-board night 2026-11-18-1602" is built in its Slice 29 row (merged #375), so that plan line's item (1) is stale, only the folder remains. Check: `ls /d/tmp-mirror-stage`.
- Slice 29 low follow-ups still present (reread 2026-11-26): the 3 s resume window `RESUME_SLACK_MS` (`background-agents.mjs`), `currentAgents` delete side effect (`session-done.mjs:105`), writeJson temp file left on kill, held goal with no SubagentStop. Fixed since: leaked `.stopped/` folders (`removeStoppedFolder` on goal expiry), `takeActiveSlot` gone. All low, none built.
- Slice 44 low follow-up left: board-address links are built twice (`addressLinks`, `stepUrls`) and hidden only by `dedupeLinks` (`web/src/SessionCards.tsx:59-87`). The `Slice N:` double prefix and the `actionBar` bold/link split are built (`plugin/scripts/sync-docs.mjs` `ownerTitleFields`, `spanEnd`).
- **Ideas to check (owner, 2026-11-18), from the survey of similar tools:** (1) Claude Code's OpenTelemetry metrics as a usage source, (2) a board answer that goes back to the waiting agent (needs the owner's yes: read-mostly rule), (3) Backlog.md folders as a second plan format for `sync_snapshot`. None is a slice yet ([note](docs/plan/notes/2026-11-18-similar-tools.md)).

**Watch (checked by plan-cleanup):**

- Slice 55: read `process_stats` (MCP tool on /mcp, last 30 days) once the owner's skills send process keys; expect review and implement keys with a `process_source` other than `derived`. Read 2026-11-26 21:41Z: 189 keys, all `process_source: derived`; the plugin pass-through is built (ClaudeSkills Slice 34, commit 1258d51), the skills send no keys yet. The two Slice 55 live checks in `unverified.md` settle then.
- Slice 57: first weekly optimiser dry-run report on the board (key `<project>/optimiser-report-<ISO week>`; read with `list_open` or `get_item`; none exists as of 2026-11-26 21:41Z). After 4 weeks of reports the owner reads them; then a new slice turns `--file-findings` on by default (Slice 57 Decision 11).

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
