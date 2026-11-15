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
| 1 | Worker + D1 items store behind an MCP endpoint | parked: built and merged (PR #31); Workers Builds connected, first deploy not run yet | #31 | | [01](docs/plan/slices/01-items-api.md) |
| 2 | Tile board page | parked: built and merged (PR #35); Access setup waits for the owner | #35 | | [02](docs/plan/slices/02-tile-board.md) |
| 5 | OAuth so claude.ai can use the MCP server | parked: built and merged (PR #42); the claude.ai connector waits for the owner, after the first deploy | #42 | | [05](docs/plan/slices/05-remote-mcp.md) |

Notes:

- [Finished slices](docs/plan/notes/slices-done.md): rows of built slices.

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

- **Not yet tried on a device:** 25 checks across 7 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- The D1 database and the Worker secrets exist.
- The client guide (`docs/clients.md`) is ready (Slice 3); the owner's config repo can start its
  client.
- Workers Builds is connected (reported by the starter session, read back 16:02Z on 2026-11-15:
  production branch `main`, no build command, deploy command `npm run deploy:ci`, preview builds off).
  No build has run yet (`wrangler deployments list`, 16:33Z: only the upload and three secret changes);
  the first one needs a push to `main` without the skip-CI marker or the deploy hook, which the
  starter session starts after the night's last merge. It holds every deployed-Worker check.
- **Waiting on the user:** create the Cloudflare Access application for the board page and set the
  `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` Worker secrets, in
  [Zero Trust, Access applications](https://one.dash.cloudflare.com/?to=/:account/access/apps) (the link was not
  opened by the run that wrote it: it needs the owner's login).
  It blocks only the two Access checks of Slice 2 (the phone check and the refused request); until
  then the deployed page answers 403.
- **Waiting on the user:** after the first deploy, add the board as a custom connector in claude.ai ([https://claude.ai/settings/connectors](https://claude.ai/settings/connectors), "Add custom connector", the Worker's `/mcp` address on `workers.dev`, not the page's custom domain, which sits behind Access; see [Slice 2](docs/plan/slices/02-tile-board.md) *Address*) and type the passphrase from the secrets store entry `OWNER_PASSPHRASE`. It blocks only the claude.ai check. (The link was not opened by the run that wrote it: it needs the owner's login.)
- `OWNER_PASSPHRASE` is in the secrets store and set as a Worker secret; the `OAUTH_KV` namespace is created by the first deploy ([Slice 5](docs/plan/slices/05-remote-mcp.md)).
- Follow-up (Slice 5): the Worker has no way for the owner to end a grant; the README names the library calls only. See [Slice 5](docs/plan/slices/05-remote-mcp.md) *Not yet verified*.
- Follow-up (Slice 7): the browser test `e2e/board.spec.ts:317` ("after a failure, Retry never leaves a blank page") failed once in a full run and is intermittent. See [Slice 7](docs/plan/slices/07-stale-detection.md) *Verification*.

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
