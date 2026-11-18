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
| 29 | Session cards keep background agents' state right | planned | | | [29](docs/plan/slices/29-agent-state-fixes.md) |
| 30 | The plugin's usage and cap scripts: review leftovers | planned | | | [30](docs/plan/slices/30-usage-script-fixes.md) |
| 31 | Plan sync and waiting cards read the documents and transcripts right | planned | | | [31](docs/plan/slices/31-sync-and-waiting-text.md) |
| 32 | Open questions are counted and kept right; ask_human can set needs_you | planned | | | [32](docs/plan/slices/32-questions-and-rules.md) |
| 33 | Doc sync never retypes live work, and checks and parts count right | planned | | | [33](docs/plan/slices/33-sync-and-checks-rules.md) |
| 34 | Storage: queries, events and indexes | planned | | | [34](docs/plan/slices/34-storage-queries.md) |
| 35 | Usage page and cost figures: review leftovers | planned | | | [35](docs/plan/slices/35-usage-page-fixes.md) |
| 36 | Board, Active and drawer pages: review leftovers | planned | | | [36](docs/plan/slices/36-board-page-fixes.md) |
| 37 | Access answers, ending a grant, and the setup page's leftovers | planned | | | [37](docs/plan/slices/37-access-and-grants.md) |
| 38 | Browser tests that don't flake | planned | | | [38](docs/plan/slices/38-steady-browser-tests.md) |
| 39 | Steps are a tree: sub-steps unfold in place, and several can run at once | planned | | | [39](docs/plan/slices/39-step-tree.md) |
| 40 | The plugin puts background agents into the step tree | planned | | | [40](docs/plan/slices/40-agents-in-tree.md) |
| 41 | Only a task with an outcome gets a card | planned | | | [41](docs/plan/slices/41-tasks-with-outcome.md) |

Notes:

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

- **Not yet tried on a device:** 76 checks across 23 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- Done 2026-11-18 (Slices 16, 18, 19): the owner pasted the connector line and the instruction text from the board's "Set up a chat" page into claude.ai Instructions ("I've updated the instructions with the 2 texts"). Whether a chat now opens a card is read from the board, not asked ([Slice 19](docs/plan/slices/19-chat-text.md)). The page will give one Copy for both pieces ([Slice 37](docs/plan/slices/37-access-and-grants.md)).
- Slices 1 to 28 are built (19 merged as PR #110, 27 as PR #109, 28 as PR #114, 26 as PR #115, all four live since the night 2026-11-17-2023 batched release): that release called the deploy hook at 22:53:22Z and `wrangler deployments list` (read 23:00Z) shows a deployment created 2026-11-17T22:54:43Z; `batch-release.mjs worker-deployed` was run after it ([note](docs/plan/notes/2026-11-17-2023-feedback-loop.md)). The plugin (Slices 20 to 23) ships from the repo, not the Worker.
- **Review follow-ups are planned as Slices 29 to 38** (re-checked against `origin/main` d654e9b on 2026-11-18, owner: "double check and plan the follow up work"). Waves, decided by the planning session: 1 = 29, 30, 31, 38; 2 = 32, 35; 3 = 33, 36; 4 = 34, 37. Already fixed or gone, so not planned: Slice 13 #9b (heartbeat advice), Slice 18 #2, Slice 22 c2 #5 and high #4, Slice 27 chk #4, chk #7, high #9, Slice 19 chk #2; Slice 26 chk #1 is probably gone and gets a closing test in Slice 35.
- **Ideas to check (owner, 2026-11-18), from the survey of similar tools:** (1) Claude Code's OpenTelemetry metrics as a usage source, (2) a board answer that goes back to the waiting agent (needs the owner's yes: read-mostly rule), (3) Backlog.md folders as a second plan format for `sync_snapshot`. None is a slice yet ([note](docs/plan/notes/2026-11-18-similar-tools.md)).
- **Kept as they are (match a rule or a decision):** Slice 9 #3 and #4 (cost derived at read; an unfitted model gives null), Slice 21 item 11 (one active step), Slice 2 pr-35-high #10 (no Cancel on the loading card; the mock draws none), Slice 14 pass-2 #6, Slice 23 med #6, med #10 and check #5, Slice 10 med #7. Slice 14 check #8 (table rebuild on real D1) can be checked only on the live database.
- **Task tree (owner, 2026-11-18, RefineScope on the Active work page):** Slices 39 (step tree, several running, tap to unfold in place, turning ring), 40 (background agents placed in the tree) and 41 (a card only for a task with an outcome; no card for plain chats or orchestrators). Order: 39 after 32; 40 after 39 and 29; 41 after 39 and 40. The owner's config repo has the matching wave-tooling slice. The mock for 37, 39, 40 and 41 is on the canvas since 2026-11-18 (ActiveV3, ActiveV3Dark, ActiveV3Phone, Setup, SetupPhone; outcome line on BoardV2 and PhoneV2), copied into `docs/design/`, and the four slices are rewritten to it; the owner replaced Slice 13's goal-less card with Slice 41's rule. Part B waves of these slices wait for the owner's review of that plan PR (owner, 2026-11-18).
- Answered 2026-11-18 (owner): a waiting card that belongs to a slice stays until the slice's work closes it; any other waiting card (a chat closed without committing to a plan) is closed after 24 hours with no report. Built in [Slice 34](docs/plan/slices/34-storage-queries.md) (follow-up of [Slice 7](docs/plan/slices/07-stale-detection.md)).
- **Owner's step:** Slice 9's German Block 3 (`web/src/strings.ts:533-535`) needs a native read ([Slice 9](docs/plan/slices/09-cap-cost-estimate.md)).
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
- Feedback loop of 2026-11-16: [note](docs/plan/notes/2026-11-16-1402-feedback-loop.md), with what waits on the owner and the open tooling findings.
- **Deploys during a night (owner, 2026-11-17, answer at the night start):** until the deploy hook exists, each housekeeping index PR of a run-all-waves night is merged **without** the skip-CI marker, so Workers Builds deploys `main` (that wave's slices and their D1 migrations) through the pipeline after every wave. Slice PRs keep the marker. This lets the config repo's work that needs Slices 13 and 14 part A live go ahead the same night. Night 2026-11-17-1216: wave 1's own index PR #76 merged with the marker (its Workers Builds check read `skipped`, as did PR #75's), so Slice 13 was not live after wave 1; housekeeping 1 tried to merge its index PR #77 without the marker, and `merge-gate.mjs` denied it ("a batch release is open", `batch-release.json` started 12:17:30Z, needs the skip-CI subject), so #77 merged with the marker too. The clash with `merge-gate.mjs` is now moot: the batched release posts the deploy hook (PR #79), so index PRs keep the skip-CI marker. Slice 13 went live at 14:16Z (2026-11-17) and Slice 14 at 15:07Z.
- Done 2026-11-17: deploy trigger. PR #79 (merged 14:24:12Z) added `.claude/merge-gate.json` with `workerPaths`; the Workers Builds deploy hook URL is in the secrets store, so a night's batched release now starts the build. The hook was posted once by hand: deployment created 2026-11-17T14:16:21Z, and migration 0006 is applied, so Slice 13 is live. Slice 14 (PR #78, merged 14:55:26Z, migration 0007) went live with the hook's build of 15:07Z (0006 and 0007 read as applied at about 16:20Z).
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
