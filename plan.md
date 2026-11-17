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

Notes:

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

- **Not yet tried on a device:** 78 checks across 23 slices, in [docs/plan/unverified.md](docs/plan/unverified.md).
- **Waiting on the user (Slices 16, 18, 19):** once the night's batched release has deployed Slice 19, open the board's "Set up a chat" page (`<board address>/#/setup`), copy the text and the connector line, and paste them in [claude.ai settings, Your Claude, Instructions](https://claude.ai/settings) so claude.ai chats report to the board ([Slice 19](docs/plan/slices/19-chat-text.md); the step is in `docs/plan/unverified.md` under Slice 19).
- Slices 1 to 28 are built (19 merged as PR #110, 27 as PR #109, 28 as PR #114, 26 as PR #115, all four after this release, so they go live with the night 2026-11-17-2023 batched release): the night 2026-11-17-1826 release called the deploy hook at 20:03:13Z and `wrangler deployments list` (read 20:04Z) shows a deployment created 2026-11-17T20:04:43Z; `batch-release.mjs worker-deployed` was run after it. The plugin (Slices 20 to 23) ships from the repo, not the Worker.
- Follow-ups (Slice 21): to plan as a follow-up slice: the background-agent state bugs 1-6 (lost stopped id under parallel SubagentStop, freshness filter bypassed, active step demoted, resumed agent forced done, goal-file write races, card left open after the last SubagentStop), in [Slice 21](docs/plan/slices/21-plugin-session-cards.md) *Follow-ups* (`reviews/pr-101-check-2-medium.md`).
- Follow-ups (Slices 22, 23): open, not built, in [Slice 23](docs/plan/slices/23-plugin-plan-sync.md) *From review* (one medium, then lows: a wait-on-work park reason that names the person in other words loses its waiting card; the slice file is matched by the first dash segment of its name; nothing holds the park rule equal in `SKILL.md`, `plan-sync.md` and `sync-docs.mjs`; the owner-step rule makes cards for slices with no open row) and [Slice 22](docs/plan/slices/22-plugin-usage.md) *From review* (lows: cap state saved before the board accepts the reading, a non-lock error skips the cap reading, the consent text omits plan name and reset times, a Node process per PostToolUse). Added by the feedback loop 2026-11-17-1826.
- Follow-ups (Slice 18): open, not built, in [Slice 18](docs/plan/slices/18-agent-setup.md) *Follow-ups* (check pass 2 #2-#4: a reworded `needs_you` restarts `needs_you_at`, helper steps replace the parent's list, a quiet chat's card expires).
- Follow-ups (Slice 13): open, not built, in [Slice 13](docs/plan/slices/13-session-cards.md) *Follow-ups from check pass 2*: `working_count` drops an in-progress item with an open question, and `askOnItem` accepts part and doc-synced items while a blank `why` wipes an open question (the two mediums), plus seven lows.
- Follow-ups (Slice 15): open, not built, in [Slice 15](docs/plan/slices/15-project-blocks.md) *Built*, "Follow-ups (low)": dead Waiting-strip leftovers and other lows.
- Follow-ups (Slice 16): open, not built, in [Slice 16](docs/plan/slices/16-chat-reports.md) *Follow-ups from review*: the SQL and JS environment identity differ, `LIMIT 500` per card crowds out older windows, string against parsed timestamps (the mediums), plus the consent-text and scope-string mismatch and lows.
- Follow-ups (Slice 14): open, not built, in [Slice 14](docs/plan/slices/14-checks-in-slice.md) *Follow-ups*: a doc slice retypes a live bug, problem, part or check that shares its key; a doc-synced bug or problem the document dropped is never closed; checks holding a question leak into counts and Active; duplicate part letters are skipped quietly; a stale part looks like the working part (the mediums), plus the lows.
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
- Follow-up (Slice 17): timing-sensitive e2e tests in `e2e/board.spec.ts` (4-5) flake when two full suites share the CPU at default workers; two suites at once need `--workers=4`; also `resolvePort` throwing on a bad `E2E_PORT` has no test (fix agent's leftover, starter session, feedback loop 2026-11-17-1826). See [Slice 17](docs/plan/slices/17-test-isolation.md).
- Follow-ups of built slices whose rows are in the finished list stay open in their slice files: [Slice 4](docs/plan/slices/04-doc-sync.md) *Follow-ups (open, not built)* (the summary counts include writes the stale-read guard skipped; a very large close fails the whole batch) and [Slice 7](docs/plan/slices/07-stale-detection.md) *Follow-ups*.
- Follow-ups (Slice 8): open, not built, in [Slice 8](docs/plan/slices/08-usage-reports.md) *Follow-ups (open, not built)* (DST over a 30-day range, an unbounded `record_at` that makes `bucketKeys` loop, and three smaller query and sort items).
- Follow-ups (Slice 9): open, not built, in [Slice 9](docs/plan/slices/09-cap-cost-estimate.md) *Follow-ups from review* (under *Built*): an environment's cap points are null if any use in the plan history is of a model with no fitted weight (the one that gives a wrong result), plus every usage read refits the whole history with no cache, the phone kinds card has no "not split" note, example palettes baked into the stored config, seven wording and rounding items, and the German sentence needs a native read.
- Follow-ups (Slice 10): open, not built, in [Slice 10](docs/plan/slices/10-task-steps.md) *Follow-ups*: `dataDropped` stays true through the error state, so an open-item address set during an outage is cleared and not reopened after Retry (the one medium item, check pass 2 #1), plus 15 smaller items (lows from the review and check passes).
- Follow-ups (Slice 11): open, not built, in [Slice 11](docs/plan/slices/11-slice-parts.md) *Follow-ups (not built)*: a valid snapshot of more than 1000 expanded items (100 slices with 10 parts each) is refused and the schema text does not say so (the one that gives a wrong result), a blocked part reads as Next or Later, plus the lows (parent cycle, part key length, a card remount on navigation).
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
