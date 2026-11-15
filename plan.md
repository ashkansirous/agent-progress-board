# Plan: agent-progress-board

One phone-friendly page that shows, per project, everything still open plus what finished in
the last 12 hours, so the owner sees at a glance what needs them. Coding agents keep it true:
state is read from each repo's plan docs, live events are pushed by agents and hooks, and both
merge on one stable key per item. The rule everything serves: **the board never blocks the
work it reports on** (reporters fail open), and **the public repo holds no private data**.

Source: the owner's phone scope "Agent Progress Board — online dashboard of work progress
across projects" (2026-11-15).

**The board exposes everything through MCP** (owner's decision at the desk, 2026-11-15): one
remote MCP endpoint is the only public contract, from Slice 1 on. Clients (reporter CLI, hooks,
doc-sync parser, cloud setup) are built by the repos that want them, starting with the owner's
private Claude Code config repo; this repo hands them a tool reference and a client guide
(Slice 3).

## Status

| Slice | Title | Status | PR | Issue | File |
| --- | --- | --- | --- | --- | --- |
| 1 | Worker + D1 items store behind an MCP endpoint | planned | | | [01](docs/plan/slices/01-items-api.md) |
| 2 | Tile board page | planned | | | [02](docs/plan/slices/02-tile-board.md) |
| 3 | Client handover: tool reference and client guide | planned | | | [03](docs/plan/slices/03-reporter.md) |
| 4 | Doc sync: `sync_snapshot` tool | planned | | | [04](docs/plan/slices/04-doc-sync.md) |
| 5 | OAuth so claude.ai can use the MCP server | planned | | | [05](docs/plan/slices/05-remote-mcp.md) |
| 6 | Reporting from Claude Code cloud sessions | planned | | | [06](docs/plan/slices/06-cloud-sessions.md) |
| 7 | Stale detection | planned | | | [07](docs/plan/slices/07-stale-detection.md) |

Notes: _(none yet; `docs/plan/notes/YYYY-MM-DD-<slug>.md`, one line each)_

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

- **Not yet tried on a device:** 0 checks across 0 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- Connect the repo to Cloudflare Workers Builds and create the D1 database: part of Slice 1;
  done by API with a Cloudflare token from the secrets store, a dashboard step only if the API
  can't (then with a direct link).

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
- Spin-offs for later: ntfy push for new waiting_for_me items (check pricing first), a daily
  overnight digest, a read-only share link per project, the board as the cloud-offload "done"
  signal instead of polling `gh pr checks`, a summary in `_STATUS.md`, a scheduled doc sync.
