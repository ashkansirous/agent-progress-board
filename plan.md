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
| 14 | Untested checks live inside their slice, problems get their own list | planned: part A, then part B (the design is in, PR #73) | | | [slice](docs/plan/slices/14-checks-in-slice.md) |
| 15 | One collapsible block per project, done work always folded | planned: after 14 (the design is in, PR #73) | | | [slice](docs/plan/slices/15-project-blocks.md) |
| 16 | Claude chat and Claude Design report to the board, and their use counts | planned: can start now, its first item is the docs check | | | [slice](docs/plan/slices/16-chat-reports.md) |

Notes:

- [Finished slices](docs/plan/notes/slices-done.md): rows of built slices.
- [Feedback loop 2026-11-15](docs/plan/notes/2026-11-15-1406-feedback-loop.md): what the end-of-run audit found.
- [Design brief 2026-11-17](docs/plan/notes/2026-11-17-design-brief.md): the page redesign for Slices 13 to 15, for Claude Design.
- Slices 13 to 15 (owner, 2026-11-17, "agree to all"): 13 and 14 edit the same server files, so 13 then 14; 15 after both. The sending side is planned in the owner's config repo. Slice 13 is built (PR #75, migration 0006, night 2026-11-17-1216 wave 1); 14 and 16 edit the same server files, so they run one after the other, then 15.
- [Feedback loop 2026-11-16](docs/plan/notes/2026-11-16-1402-feedback-loop.md): what the audit of the second night found.
- Slices 1 to 7 are built and merged and deployed; 1 is verified, 5 works in claude.ai (owner, 2026-11-16; the phone check is open), and the open checks of the rest are in `docs/plan/unverified.md` (2026-11-16).
- Slices 8 to 11 (owner, 2026-11-16) run in this order: 8, 9, 10, 11. Slices 8, 9, 10 and 11 are built (PRs #53, #57, #60, #66); 8, 9 and 10 are deployed (8 and 9 by the deployment created 2026-11-16T16:24:39Z, 10 by the one created 17:15:11Z); 11 is deployed too (PR #68 merged without the skip-CI marker at 18:24:55Z; deployment created 2026-11-16T18:25:23Z, and the migrations list read at about 18:32Z shows none left, so migration 0005 is applied). They edit the same server files, so one at a time. In each, part A (server) can be built now and part B (the page) is planned against the design mock the owner added on 2026-11-16 (`docs/design/`). The sending side is planned in the owner's private config repo.

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

- **Not yet tried on a device:** 36 checks across 10 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- Done 2026-11-17: the owner added the board-by-project artboards to the [design canvas](https://claude.ai/artifact/PZyqwkfjuwQkE4BE6UfeDd); they are copied into `docs/design/` and part B of Slices 13 and 14 and all of 15 are rewritten to them.
- [PR #73](https://github.com/ashkansirous/agent-progress-board/pull/73) merged without a review round (owner, 2026-11-17: "you dont need to wait for my fucking reviews! fucking merge them always"); its four open points stand as written in the slices unless the owner overrules one. The part B waves of Slices 13 to 15 can start.
- The D1 database and the Worker secrets exist.
- The client guide (`docs/clients.md`) is ready (Slice 3); the owner's config repo can start its
  client.
- Workers Builds is connected (production branch `main`, no build command, deploy command
  `npm run deploy:ci`, preview builds off; read back 16:02Z on 2026-11-15) and has run once: the
  check "Workers Builds: agent-progress-board" on the merge commit of PR #47 (c1cc5de) completed with
  success.
- The Worker is deployed (first deployment created 17:00:39Z on 2026-11-15, read from
  `wrangler deployments list`). A deploy happens on a merge to `main` without the skip-CI marker.
  On its workers.dev address `/mcp` answers 401 without a token, the page and `/api/board` answer 403.
- Done 2026-11-15 (18:29Z to 18:34Z, read back): the custom hostname is attached to the Worker as a
  Custom domain and resolves; a self-hosted Access application "Agent progress board" with one
  Allow policy for the owner's email address covers it; `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are
  set as Worker secrets and recorded in the secrets store. Without a session the custom hostname
  answers 302 to the Access login (also `POST /mcp`); on workers.dev the page answers 403 and
  `POST /mcp` 401. See [Slice 2](docs/plan/slices/02-tile-board.md) (the hostname is not written
  in this repo).
- The owner opened the board page on the custom hostname from a phone on 2026-11-15 and signed in
  ("it works on my phone"). What they saw was the 205 test items of project `zz-deploy-check` that the
  deployed checks of that day had left, and it made no sense to them. With the owner's yes those items
  and their 412 events were deleted from the live database the same evening (`wrangler d1 execute
  --remote`; a count afterwards shows 0 items and 0 events). The board is empty until a client reports.
  Rule for later checks: a check that writes to the live board removes its own rows in the same run and
  never writes more than a handful.
- Still there from those checks: one OAuth client registered on the live Worker (it cannot be
  deleted through the Worker). Since 2026-11-16 the owner's claude.ai grant exists too.
- Done 2026-11-16: the owner added the design mock for the usage page, the active work page and the parts bar to the canvas; it is copied into `docs/design/` and part B of Slices 8 to 11 is rewritten to match it.
- `OWNER_PASSPHRASE` is in the secrets store and set as a Worker secret; the `OAUTH_KV` namespace is created by the first deploy ([Slice 5](docs/plan/slices/05-remote-mcp.md)).
- Follow-up (Slice 5): the Worker has no way for the owner to end a grant; the README names the library calls only. See [Slice 5](docs/plan/slices/05-remote-mcp.md) *Not yet verified*.
- Follow-up (Slice 7): the browser test `e2e/board.spec.ts:317` ("after a failure, Retry never leaves a blank page") failed once in a full run and is intermittent. See [Slice 7](docs/plan/slices/07-stale-detection.md) *Verification*; the likely cause (wall-clock timing windows) is the fifth follow-up in [Slice 2](docs/plan/slices/02-tile-board.md).
- Follow-ups of built slices whose rows are in the finished list stay open in their slice files: [Slice 4](docs/plan/slices/04-doc-sync.md) *Follow-ups (open, not built)* (the summary counts include writes the stale-read guard skipped; a very large close fails the whole batch) and [Slice 7](docs/plan/slices/07-stale-detection.md) *Follow-ups*.
- Follow-ups (Slice 8): open, not built, in [Slice 8](docs/plan/slices/08-usage-reports.md) *Follow-ups (open, not built)* (DST over a 30-day range, an unbounded `record_at` that makes `bucketKeys` loop, and three smaller query and sort items).
- Follow-ups (Slice 9): open, not built, in [Slice 9](docs/plan/slices/09-cap-cost-estimate.md) *Follow-ups from review* (under *Built*): an environment's cap points are null if any use in the plan history is of a model with no fitted weight (the one that gives a wrong result), plus every usage read refits the whole history with no cache, the phone kinds card has no "not split" note, example palettes baked into the stored config, seven wording and rounding items, and the German sentence needs a native read.
- Follow-ups (Slice 10): open, not built, in [Slice 10](docs/plan/slices/10-task-steps.md) *Follow-ups*: `dataDropped` stays true through the error state, so an open-item address set during an outage is cleared and not reopened after Retry (the one medium item, check pass 2 #1), plus 15 smaller items (lows from the review and check passes).
- Follow-ups (Slice 11): open, not built, in [Slice 11](docs/plan/slices/11-slice-parts.md) *Follow-ups (not built)*: a valid snapshot of more than 1000 expanded items (100 slices with 10 parts each) is refused and the schema text does not say so (the one that gives a wrong result), a blocked part reads as Next or Later, plus the lows (parent cycle, part key length, a card remount on navigation).
- Feedback loop of 2026-11-16: [note](docs/plan/notes/2026-11-16-1402-feedback-loop.md), with what waits on the owner and the open tooling findings.
- **Deploys during a night (owner, 2026-11-17, answer at the night start):** until the deploy hook exists, each housekeeping index PR of a run-all-waves night is merged **without** the skip-CI marker, so Workers Builds deploys `main` (that wave's slices and their D1 migrations) through the pipeline after every wave. Slice PRs keep the marker. This lets the config repo's work that needs Slices 13 and 14 part A live go ahead the same night. Night 2026-11-17-1216: wave 1's own index PR #76 merged with the marker (its Workers Builds check read `skipped`, as did PR #75's), so Slice 13 was not live after wave 1; housekeeping 1's index PR is merged without the marker to deploy it.
- **Deploy trigger, the owner's step:** create the deploy hook in the Build section of the [Worker's settings](https://dash.cloudflare.com/?to=/:account/workers/services/view/agent-progress-board/production/settings); the rest of this task follows.
- **Deploy trigger, open tooling task:** add `.claude/merge-gate.json` with `workerPaths` (`src/**`, `web/**`, `migrations/**`, `wrangler.jsonc`, `package.json`) and a Workers Builds deploy hook URL in the secrets store, so a batch release starts the build. Creating the hook needs the Cloudflare dashboard (the machine's wrangler login has no Workers Builds scope). PR #61 was merged without the skip-CI marker, and Workers Builds deployed `main` at 6bbae7f (check success at 16:24:44Z, deployment created 16:24:39Z on 2026-11-16), so the work of PRs #53 and #57 (Slices 8 and 9) is live and migration 0003 is applied (the migrations list read between 17:10Z and 17:13Z shows only 0004 left). PR #60 (Slice 10) merged after that with the skip-CI marker and its check read `skipped`. The docs PR #63 was then merged without the marker (a mistake of housekeeping 3: its merge was meant to carry it), so Workers Builds deployed `main` at f5bf489 (check success at 17:15:24Z, deployment created 17:15:11Z): Slice 10 is live and migration 0004 is applied (the migrations list read at 17:15Z shows none left). A batch release run by hand at 16:21Z started nothing (no runs, no hook), which is why this task is still open. Until the hook exists, a merge to `main` without the skip-CI marker is what deploys.
- Feedback loop of 2026-11-15: [note](docs/plan/notes/2026-11-15-1406-feedback-loop.md), with the open tooling findings it could not fix in its time.

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
