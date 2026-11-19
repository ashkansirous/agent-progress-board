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
| 49 | Follow-ups left open by Slice 48 | planned | | | [slice](docs/plan/slices/49-slice-48-follow-ups.md) |
| 50 | Item tools one by one and in batches, archive instead of delete | planned | | | [slice](docs/plan/slices/50-batch-and-archive.md) |

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

- **Not yet tried on a device:** 109 checks across 42 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- Done 2026-11-18 (Slices 16, 18, 19): the owner pasted the connector line and the instruction text from the board's "Set up a chat" page into claude.ai Instructions ("I've updated the instructions with the 2 texts"). Whether a chat now opens a card is read from the board, not asked ([Slice 19](docs/plan/slices/19-chat-text.md)). The page will give one Copy for both pieces ([Slice 37](docs/plan/slices/37-access-and-grants.md)).
- Slices 1 to 28 are built (19 merged as PR #110, 27 as PR #109, 28 as PR #114, 26 as PR #115, all four live since the night 2026-11-17-2023 batched release): that release called the deploy hook at 22:53:22Z and `wrangler deployments list` (read 23:00Z) shows a deployment created 2026-11-17T22:54:43Z; `batch-release.mjs worker-deployed` was run after it ([note](docs/plan/notes/2026-11-17-2023-feedback-loop.md)). The plugin (Slices 20 to 23) ships from the repo, not the Worker.
- Slices 29 to 46 are built and live (PRs #129 to #172); Slice 47 is built and live (PR #179, merged 2026-11-19T07:01Z). Worker deployments behind them (`wrangler deployments list`, read 2026-11-19 05:34Z): 2026-11-18T22:29:23Z (night 1602 waves 1 to 4), 2026-11-19T02:21:52Z (Slices 34, 41, 43 and 44, with migrations 0008 and 0009), 04:17:55Z (Slice 45), 04:42:36Z (the plan merge #171) and 05:29:53Z (Slice 46) and, read 07:10Z, 2026-11-19T07:10:15Z (Slice 47); `batch-release.mjs worker-deployed` was run after the last ([note](docs/plan/notes/2026-11-19-0554-feedback-loop.md)). Slices 29, 30, 31 and 38 change only plugin scripts and browser tests. Slice 48 is built and live (PR #184, merged 2026-11-19T08:22Z): the night 0734 release called the deploy hook at 08:28:22Z and `wrangler deployments list` (read 08:35Z) shows a deployment created 2026-11-19T08:29:49Z; `batch-release.mjs worker-deployed` was run after it ([note](docs/plan/notes/2026-11-19-0734-feedback-loop.md)). No slice is planned; Slice 48's four check-3 nits are [Slice 49](docs/plan/slices/49-slice-48-follow-ups.md), planned for the owner.
- Settled (Slice 36's tab-bar question): the newer mocks `PhoneV2` and `ActiveV3Phone` win, and Slice 43 (PR #156) moved the Usage page's phone tab bar to the top like Board and Active work ([Slice 43](docs/plan/slices/43-owner-cards-read-right.md)).
- **Slice 45 built the follow-ups of Slices 29 to 32, 37, 38 and 41 to 44** ([Slice 45](docs/plan/slices/45-night-1602-follow-ups.md), PR #167). Not built, with reasons in its *Found while building*: item 13 #1 and #3 (Slice 30), item 14 #4 and check-3 #3 (Slice 29), item 4 #8 (Slice 32), item 7 #3 (Slice 43). Item 8's live "NaN:00" check can run now (Slice 45 live since 04:17:55Z; in `docs/plan/unverified.md`).
- **Slice 46 built the follow-ups left open by Slice 45** ([Slice 46](docs/plan/slices/46-slice-45-follow-ups.md), PR #172, live since the 05:29:53Z deployment; two live hook checks in `docs/plan/unverified.md`): the held Stop report that re-opened a closed card, the `|` inside a double-backtick span in an owner-step title, five lows and the empty-status-table question.
- `D:\tmp-mirror-stage` (two copied doc files) was left at the drive root by night 2026-11-18-1602 wave 3's mirror agent; every agent's delete was blocked by a safety check, so it waits for the owner to delete it. The guard gap is a ClaudeSkills plan item (ClaudeSkills #350).
- **Review follow-ups were planned as Slices 29 to 38, and all ten are built (night 2026-11-18-1602)** (re-checked against `origin/main` d654e9b on 2026-11-18, owner: "double check and plan the follow up work"). Waves, decided by the planning session: 1 = 29, 30, 31, 38; 2 = 32, 35; 3 = 33; 4 = 34; Slice 37 was built before 36, so 36 follows 37. Already fixed or gone, so not planned: Slice 13 #9b (heartbeat advice), Slice 18 #2, Slice 22 c2 #5 and high #4, Slice 27 chk #4, chk #7, high #9, Slice 19 chk #2; Slice 26 chk #1 is probably gone and gets a closing test in Slice 35.
- **Ideas to check (owner, 2026-11-18), from the survey of similar tools:** (1) Claude Code's OpenTelemetry metrics as a usage source, (2) a board answer that goes back to the waiting agent (needs the owner's yes: read-mostly rule), (3) Backlog.md folders as a second plan format for `sync_snapshot`. None is a slice yet ([note](docs/plan/notes/2026-11-18-similar-tools.md)).
- **Kept as they are (match a rule or a decision):** Slice 9 #3 and #4 (cost derived at read; an unfitted model gives null), Slice 21 item 11 (one active step), Slice 2 pr-35-high #10 (no Cancel on the loading card; the mock draws none), Slice 14 pass-2 #6, Slice 23 med #6, med #10 and check #5, Slice 10 med #7. Slice 14 check #8 (table rebuild on real D1) can be checked only on the live database.
- **Task tree (owner, 2026-11-18, RefineScope on the Active work page):** Slices 39 (step tree, several running, tap to unfold in place, turning ring), 40 (background agents placed in the tree) and 41 (a card only for a task with an outcome; no card for plain chats or orchestrators). Order: 39 after 32; 40 after 39 and 29; 41 after 39 and 40. The owner's config repo has the matching wave-tooling slice. The mock for 37, 39, 40 and 41 is on the canvas since 2026-11-18 (ActiveV3, ActiveV3Dark, ActiveV3Phone, Setup, SetupPhone; outcome line on BoardV2 and PhoneV2), copied into `docs/design/`, and the four slices are rewritten to it; the owner replaced Slice 13's goal-less card with Slice 41's rule. No review wait: the owner settled every decision in RefineScope and the answers of 2026-11-18, so the waves start now (owner, 2026-11-18: "you should not wait for my review").
- Answered 2026-11-18 (owner): a waiting card that belongs to a slice stays until the slice's work closes it; any other waiting card (a chat closed without committing to a plan) is closed after 24 hours with no report. Built in [Slice 34](docs/plan/slices/34-storage-queries.md) (follow-up of [Slice 7](docs/plan/slices/07-stale-detection.md)).
- The page is English only (owner, 2026-11-19: "this project has no fucking language than english"). The German table Slice 2 added unasked was removed in [Slice 44](docs/plan/slices/44-english-only-owner-steps.md) (PR #160, merged 2026-11-19), and no German check goes to the owner.
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
