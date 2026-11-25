# Not yet verified

Every open "Not yet verified" check, one block per slice. A check that passes, or that the
owner confirms, is removed here and its slice marked `verified`.

### Slice 53: Task tools become card steps with times seen by the hooks ([slice](slices/53-task-tools-steps.md))

- [session] A real session with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` shows its tasks as steps, with times within a minute of the transcript (read back with `get_item`).
- [session] The `TaskUpdate` `tool_input` keys (`taskId`, `status`) are seen in a live payload.
- [session] A compaction adds to the running step's count.

### Slice 51: Blocked step state, true step times, and a visible reason when a card reopens ([slice](slices/51-blocked-steps-true-times.md))

- [chrome] On the live board after the release, a slice card with a blocked step shows orange, and an owner-blocked one shows red under Needs you.
- [session] In a real session, the hook's reports keep the session's own step children and drop an aged-out agent row.

### Slice 50: Item tools one by one and in batches, archive instead of delete ([slice](slices/50-batch-and-archive.md))

- [session] After release, run the plugin's sync in the owner's repo that hit the 200-item cap: it sends in several batches, no "exceed the 200-item cap" line appears, and the board's project block shows its open slices.
- [session] After release, archive one test item with `archive_item`: it is gone from the board and readable with `get_item` and `include_archived`.

### Slice 52: Spike, one session's true step timeline ([slice](slices/52-timeline-spike.md))

- [session] Compaction before/after context was not measured (the 87 s run had none): the cost slice forces one compaction to measure before/after context.

### Slice 48: Follow-ups left open by Slice 47 ([slice](slices/48-slice-47-follow-ups.md))

- [chrome] Items 1 and 2: on the live page, an aborted first load shows no stranded spinner, and returning to `#/needs-you` or an Active card scrolls again. Tried 2026-11-19: the aborted first load was not provoked; the scroll half passed (scrollY 0 to 672 on arrival at `#/needs-you`).

### Slice 47: Open review follow-ups of Slices 33 to 36, 39 to 41 and 46 ([slice](slices/47-open-follow-ups.md))

- [chrome] Opening `#/needs-you` scrolls to the first waiting card once per arrival, and a drawer at `#/open/<key>` opens on fresh data. Tried 2026-11-19: the scroll half passed, but a drawer opened with no new board fetch, so its freshness is not proven.
- [session] After the plugin updates and a session restarts, the plugin hook changes (`pruneAgents`, `hook-input.mjs`, `report-progress.mjs`) keep the session card and its agent rows right through a subagent run. Tried 2026-11-19: needs a plugin update and a session restart; the board still shows the owner step "restart Claude Code" open.

### Slice 46: Follow-ups left open by Slice 45 ([slice](slices/46-slice-45-follow-ups.md))

- [session] After the plugin updates and a session restarts, a Stop that follows a SubagentStop leaves the session card closed (item 1). Tried 2026-11-19: needs a controlled SubagentStop and Stop run, which cannot be made without creating cards.
- [session] A waiting card whose question holds a `-p <secret>` line shows it masked on the board (item 7). Tried 2026-11-19: no such waiting card is on the board.

### Slice 44: English only, and an owner step reads as a short title plus its steps ([slice](slices/44-english-only-owner-steps.md))

- [chrome] After the release, the page reads English on a browser set to German. Tried 2026-11-19: the browser language cannot be set to German without changing Chrome settings.
- [chrome] A `**You:** ` line in the new form shows on the board as "Slice N: <action>" with its steps underneath. Tried 2026-11-19: no card in the new form is on the board; owner steps read "YOUR STEP" plus text.

### Slice 43: Owner steps on the board read right ([slice](slices/43-owner-cards-read-right.md))

- [chrome] The Verification box in the slice: after the release and one doc sync on the live board, "Needs you" shows owner steps as "Your step" with working links and `AGENT_BOARD_URL` in full. Tried 2026-11-19: "YOUR STEP" cards render with text, but none holds a link or `AGENT_BOARD_URL`, so the links half is unseen.
- [phone] The phone card shows the project name, not "Your step" (check pass 2 #6, follow-up). Tried 2026-11-19: phone Chrome stops at the Access sign-in.
- [chrome] The live Usage page's Environment tab shows no overlapping "Reset" across a weekly reset ([Slice 45](slices/45-night-1602-follow-ups.md) item 8). The "NaN:00" half passed in Chrome on 2026-11-19; the reset half could not be seen because no reset fell in the window (next: Tue 24 Nov). When it passes, `mark_done` the bug card `agent-progress-board/bug-usage-env-axis-nan`.

### Slice 41: Only a task with an outcome gets a card ([slice](slices/41-tasks-with-outcome.md))

- [session] A plain chat question makes no card. Tried 2026-11-19: an absence cannot be seen without creating a plain chat.
- [session] The PostToolUse reminder fires once per prompt in a live Claude Code session. Tried 2026-11-19: the reminder is not observable from the board and the plugin data holds no log of it.

### Slice 34: Storage: queries, events and indexes ([slice](slices/34-storage-queries.md))

- [session] After the release, `wrangler d1 migrations list --remote` shows 0008 applied (read only). Tried 2026-11-19: needs `wrangler d1 --remote`, denied by the permission check.

### Slice 33: Doc sync never retypes live work, and checks and parts count right ([slice](slices/33-sync-and-checks-rules.md))

- [chrome] After the release, the owner's next plan sync shows the same `checks_not_tried` count as the slice files, and a stale or blocked check shows muted under its slice. Tried 2026-11-19: the board header shows 71 checks for the config repo against 73 in its unverified.md; the slice-file counts and the muted style were not compared.

### Slice 40: The plugin puts background agents into the step tree ([slice](slices/40-agents-in-tree.md))

- [session] On the owner's machine, two background agents show as running child rows under the step that started them, and a helper's own steps appear under its row (no device run: plugin hook behaviour needs a real Claude Code session). Tried 2026-11-19: a session card notes "background agents running", but no agent child rows were seen on the board.

### Slice 39: Steps are a tree: sub-steps unfold in place, and several can run at once ([slice](slices/39-step-tree.md))

- [phone] On a phone and the deployed board, a real tree with helpers reporting `under_step` in parallel. Tried 2026-11-19: phone Chrome stops at the Access sign-in.
- [phone] The ring under reduced motion, on a real device. Tried 2026-11-19: phone Chrome stops at the Access sign-in.

### Slice 36: Board, Active and drawer pages: review leftovers ([slice](slices/36-board-page-fixes.md))

- [phone] On a phone, the board read stops one tick after leaving a page, and the Usage tab count reads the cached board. Tried 2026-11-19: phone Chrome stops at the Access sign-in.
- [phone] On a phone, the open drawer stays open through a reload. Tried 2026-11-19: phone Chrome stops at the Access sign-in.

### Slice 35: Usage page and cost figures: review leftovers ([slice](slices/35-usage-page-fixes.md))

- [phone] On a phone or desktop in a zone with daylight saving, the Usage page's bars, reset markers and labels line up across a clock change (next change: late March).

### Slice 32: Open questions are counted and kept right; `ask_human` can set `needs_you` ([slice](slices/32-questions-and-rules.md))

- [chat] A live `ask_human` from a chat sets `needs_you` on its card, after the release.

### Slice 42: A built slice whose checks are untried shows as built, not in progress ([slice](slices/42-built-not-in-progress.md))

- [phone] A device look at the Built section on a phone. Tried 2026-11-19: phone Chrome stops at the Access sign-in.

### Slice 37: Access answers, ending a grant, and the setup page's leftovers ([slice](slices/37-access-and-grants.md))

- [session] Key cool-down: see the Decision above (`guardedKeys` in `src/api/access.ts`). Tried 2026-11-19: needs a forced Access key failure, which cannot be provoked read-only.

### Slice 31: Plan sync and waiting cards read the documents and transcripts right ([slice](slices/31-sync-and-waiting-text.md))

- [session] A real Notification hook run on the owner's machine opens a waiting card with masked text. Tried 2026-11-19: no Notification-hook waiting card with masked text was on the board.
- [session] A real plan sync from a repo with parked slices. Tried 2026-11-19: no sync from a repo with parked slices ran during the pass.

### Slice 30: The plugin's usage and cap scripts: review leftovers ([slice](slices/30-usage-script-fixes.md))

- [session] A real session on the owner's machine sends cap readings after a plan switch with the address unusable. Tried 2026-11-19: no plan switch with an unusable address was seen.
- [cloud] The `docs/setup/cloud.md` setup loop on a real cloud box.

### Slice 29: Session cards keep background agents' state right ([slice](slices/29-agent-state-fixes.md))

- [session] On the owner's machine: one session with two parallel background agents. Both agents' steps show, the card closes after the last stops, and the title stays. Tried 2026-11-19: needs two parallel background agents in a controlled session; none was seen.

### Slice 28: Cloud and VM sessions report their usage under their own label ([slice](slices/28-cloud-usage.md))

- [cloud] A real cloud session's usage shows on the usage page under its own label.
- [cloud] The cloud records path `/root/.claude` is untried in a real cloud session.
- [cloud] The setup-time variables (unset during the setup script) are untried.
- [cloud] The Stop hook's detached send (`usage-tick` spawns a background run) is untried in a cloud VM.

### Slice 26: The "all kinds" cost figure stays steady across a weekly reset ([slice](slices/26-mix-after-reset.md))

- [session] Live before/after figure across a weekly reset (work item 1): needs a data export replayed through `readUsage`. Tried 2026-11-19: needs a data export replayed through `readUsage` offline.
- [chrome] The page on the live board after the first weekly reset since this merged.

### Slice 27: Every "Needs you" card says what is needed, for which work, and why ([slice](slices/27-needs-you-cards.md))

- [session] In a real Claude Code session with the plugin: an idle prompt after a status line opens no card; one after a question opens a card with that question; a permission prompt card names the tool and command. Tried 2026-11-19: no idle-prompt or permission-prompt card was on the board.

### Slice 22: Token usage and cap readings from the plugin ([slice](slices/22-plugin-usage.md))

- [session] With `report_usage` off no usage call goes out and the card stays live. Tried 2026-11-19: needs `report_usage` turned off, a settings change.
- [session] That `CLAUDE_CONFIG_DIR` reaches the plugin's hooks (the fixer did not check Claude Code's docs). Tried 2026-11-19: not checked.

### Slice 24: Set up your own board: a guide Claude follows ([slice](slices/24-own-board-guide.md))

- [owner] The Access step assumes the page is on a custom hostname and agents use the `workers.dev` address (how the live board was built); Access directly on `workers.dev` was not tried.
- [owner] That a Workers Builds token on a fresh account can run the D1 migrations in `deploy:ci` and provision the `OAUTH_KV` namespace on the first deploy ("created for you" in the guide); if the token lacks D1 edit the deploy fails with an auth error.
- [owner] A fresh Claude Code following the guide in a new Cloudflare account ends with a board that shows a test card.
- [owner] The dashboard menu path in `docs/setup/own-board.md` for editing the Workers Builds token (not checked).
- [owner] The guide's Workers Builds fields (branch `main`, no build command, `npm run deploy:ci`, previews off), taken from the Slice 1 record, not confirmed in docs.

### Slice 21: Session cards report themselves from the plugin's hooks ([slice](slices/21-plugin-session-cards.md))

- [session] `plugin/hooks/hooks.json` exec form and the PostToolUse tool name `mcp__plugin_agent-board_agent-board__report_progress` not seen in a live session. Tried 2026-11-19: the hooks file and tool name are not visible from the board.
- [session] On Windows, the hook's reminder JSON reaches the session whole (the check pass replaced `process.exit(0)` with `process.exitCode`; the truncation was never reproduced). Tried 2026-11-19: the truncation cannot be reproduced read-only.
- [session] In a live session an open question survives Stop and is cleared by the next prompt (UserPromptSubmit/PostToolUse close of waiting items, added by the check pass). Tried 2026-11-19: needs an open question in a controlled session.

### Slice 20: A Claude Code plugin and a setup guide ([slice](slices/20-plugin-connect.md))

- [owner] A fresh Claude Code on another machine, given only the README sentence, connects and shows a card.
- [session] Auto-update delivers a change to an installed client after a merge. Tried 2026-11-19: needs a later merge to observe.
- [session] Install from the GitHub marketplace source (`claude plugin marketplace add <owner>/<repo>`) with the plugin merged on `main`: tested only from a local path in a throwaway `CLAUDE_CONFIG_DIR`. Tried 2026-11-19: the marketplace install was not rerun.
- [session] The test card steps of `docs/setup/connect.md` (`report_progress`, `get_item`, `mark_done`) run by a Claude Code session, and the skill loading in a session (only the MCP connection was checked). Tried 2026-11-19: `list_open` and `get_item` work, but `report_progress` and `mark_done` were not run (no cards created).
- [session] The stdin-from-a-file form of `claude plugin configure --values-stdin` in `docs/setup/connect.md` step 4 was not run (only the pipe form was). Tried 2026-11-19: the configure form was not run.

### Slice 18: Every AI that connects to the board is told how to report ([slice](slices/18-agent-setup.md))

- [chat] Whether a claude.ai chat shows the server's instructions to the model. Check: a new chat with only the connector (no pasted text) opens a `my-chats` card. If it does, the owner's pasted instruction can be removed.

### Slice 16: Claude chat and Claude Design report to the board, and their use counts ([slice](slices/16-chat-reports.md))

- [owner] The same instruction in a Claude Design session (Claude Design calling the connector is unproven; see the first Work item). Asked of the owner only after Slice 19 is built.
- [owner] Claude Design and custom connectors are unproven in the docs.
- [chat] The claude.ai settings path in `docs/clients.md` (*Claude chat*: Settings, "Your Claude", Instructions) was never read from the live site (feedback loop 2026-11-17-1826).

### Slice 15: One collapsible block per project, done work always folded ([slice](slices/15-project-blocks.md))

- [owner] The owner compares the deployed board on the phone and on the desktop with the mock (`BoardV2`, `BoardV2Dark`, `PhoneV2`, `PhoneV2Light`, `PhoneV2Drawer`, `StatesV2`).
- [owner] The "Other open items" group (not in the mock) is kept; the owner says whether to keep it.

### Slice 14: Untested checks live inside their slice, and problems get their own list ([slice](slices/14-checks-in-slice.md))

- [chrome] On the deployed board after a real doc sync: no card per check, and the header total equals the count line in `plan.md` (needs the config repo's client to send `checks`). Tried 2026-11-19: FAIL as read: there is no card per check, but the board header shows 71 checks for the config repo against 73 in its plan and unverified.md on `origin/main`, maybe sync lag since 10:45Z; rerun after the next sync.
- [session] Migration 0007 is applied on the live D1 (`wrangler d1 migrations list --remote` showed none left at about 16:20Z on 2026-11-17); still to check: the `items` and `events` row counts survived its table rebuild (Slice 14 check pass #8, "confirm on real D1"). Tried 2026-11-19: needs `wrangler d1 --remote`, denied by the permission check.
- [owner] The owner compares the deployed page with `BoardV2.dc.html` and `BoardV2Dark.dc.html`.

### Slice 13: A session card says what it is doing and what it needs ([slice](slices/13-session-cards.md))

- [session] On the deployed board, a stopped session leaves Working now at once. Tried 2026-11-19: no session stop was seen.
- [owner] The owner's comparison of the deployed page with the mocks.
- [chrome] The drawer history of a working card with several events, in a browser. Tried 2026-11-19: the drawer history was not opened.
- [chrome] The 1.5px border (renders as 1px in the browser run). Tried 2026-11-19: the border was not measured.
- [chrome] The seeded question's drawer history shows each event once (the doubled row was fixed after the browser run and not re-run). Tried 2026-11-19: the seeded question is gone, so it was not re-run.

### Slice 11: Slice parts: progress bar on the slice, click through to the active part ([slice](slices/11-slice-parts.md))

- [session] On the deployed board after a real document sync and a real agent run, a slice shows its bar and the click lands on the part the agent holds (needs the deploy and a client that sends parts). Tried 2026-11-19: no client sending parts was seen.
- [phone] The follow link row on the phone tile (44 px row, text #E8EAEE) was not measured in the browser run. Tried 2026-11-19: phone Chrome stops at the Access sign-in.
- [phone] The 1.5 px circle border on a screen with pixel ratio 2 or more. Tried 2026-11-19: phone Chrome stops at the Access sign-in.

### Slice 10: Task steps and the active work page ([slice](slices/10-task-steps.md))

- [phone] The phone tile bar gap reads 2 px where the slice says "4 gap" (ambiguous).
- [chrome] Dark desktop (no artboard).
- [chrome] The loading blocks' colours and the failed card against the mock.

### Slice 9: What 1% of the cap costs, per model ([slice](slices/09-cap-cost-estimate.md))

- [chrome] On the deployed board after some days of real reports: the estimate for a model that ran alone matches a hand calculation from the page's own numbers. Tried 2026-11-19: no hand calculation for a model that ran alone was done.
- [chrome] Dark desktop values.
- [chrome] Pixel-level chart marks.
- [phone] The page on the owner's phone. Tried 2026-11-19: phone Chrome stops at the Access sign-in.

### Slice 8: Usage reports: tokens per model, cap readings, usage page ([slice](slices/08-usage-reports.md))

- [session] Thinning from the live cron. Tried 2026-11-19: thinning is not observable.
- [phone] The page on the owner's phone through Access, against the mock. Tried 2026-11-19: phone Chrome stops at the Access sign-in.

### Slice 5: OAuth so claude.ai can use the MCP server ([slice](slices/05-remote-mcp.md))

- [owner] The same question ("what's waiting for me on the agent progress board?") from the claude.ai app on a phone. Seen by the owner 2026-11-16: the connector added and the question answered in a claude.ai chat; the device was not said.
- [session] A static bearer token with `public_origin` set and a different request host still gets through (check-2 finding 8). Tried 2026-11-19: a static-token request from a different host cannot be sent without changing config.

### Slice 7: Stale detection ([slice](slices/07-stale-detection.md))

- [session] The cron trigger registers on deploy and fires. Seen 2026-11-16: `wrangler.jsonc` declares one cron, `*/15 * * * *`. Not seen: its registration on the live Worker, or a firing. Tried 2026-11-19: needs `wrangler` against the remote Worker, denied by the permission check.
- [session] The account's free-plan limit of 5 cron triggers is not exceeded. Tried 2026-11-19: the cron count is not readable without `wrangler`, denied by the permission check.
- [chrome] A stale item recovers on its next report, on the live board. Tried 2026-11-19: the stale half passed (a killed session turned stale); no recovery was seen in the window.

### Slice 2: Tile board page ([slice](slices/02-tile-board.md))

- [phone] Seeded data shows correctly on the owner's phone, opened from the deployed URL through Access (drawer and waiting strip included). Seen 2026-11-15: the owner opened the page on the custom hostname from a phone, signed in through Access and said "it works on my phone"; what they saw was the leftover test items, not seeded data. Not seen: the seeded data, drawer and waiting strip on the phone. Tried 2026-11-19: phone Chrome stops at the Access sign-in.
- [session] The first pipeline run of the new `deploy:ci` (`vite build`, then migrations, then deploy with `web/dist/agent_progress_board/wrangler.json`); locally `vite build` and `wrangler deploy --dry-run` passed. Seen 2026-11-15: the check "Workers Builds: agent-progress-board" on c1cc5de succeeded and the Worker is live with migrations applied. Not seen: the pipeline log. Tried 2026-11-19: the pipeline log was not read.
- [session] Worker secrets (`ACCESS_*`, `BOARD_CONFIG`) survive a pipeline deploy. Seen 2026-11-15: `BOARD_WRITE`/`BOARD_READ` tokens and the `OWNER_PASSPHRASE` page work after the deploy. Seen 2026-11-15: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set. Seen 2026-11-16: after the deployment of 13:02:51Z `wrangler secret list` shows `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `BOARD_READ_TOKEN`, `BOARD_WRITE_TOKEN` and `OWNER_PASSPHRASE`; `BOARD_CONFIG` is not set as a secret (it is optional). Tried 2026-11-19: needs `wrangler secret list` against the remote Worker, denied by the permission check.
- [owner] The seed script run against the deployed Worker. Note 2026-11-16: the live board now holds real items, so a seed run there would break the rule in `plan.md` (a check that writes to the live board writes a handful of rows and removes them in the same run); it needs a decision first.
- [session] The Node version in `engines` (`>= 22.18.0`): the number comes from the review and the fixer's knowledge; context7 confirmed only that type stripping is default in Node 24. Tried 2026-11-19: the figure was not checked.

### Slice 6: Reporting from Claude Code cloud sessions ([slice](slices/06-cloud-sessions.md))

- [cloud] A slice built in a cloud session updates its tile; waits for the first deploy and the client
  in the owner's config repo.
- [cloud] How a network secret reaches an outgoing request: read the docs' "Add network secrets"
  section and try it in one real cloud session (client author).

### Slice 3: Client handover: tool reference and client guide ([slice](slices/03-reporter.md))

- [session] A client written only from the guide reports a real run and its tiles move live (waits for the first deploy and for the client in the owner's config repo).

