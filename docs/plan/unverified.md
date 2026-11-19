# Not yet verified

Every open "Not yet verified" check, one block per slice. A check that passes, or that the
owner confirms, is removed here and its slice marked `verified`.

### Slice 41: Only a task with an outcome gets a card ([slice](slices/41-tasks-with-outcome.md))

- After the release and the config repo's matching slice, one wave night shows slice cards with their trees and no wave card.
- A plain chat question makes no card.
- The PostToolUse reminder fires once per prompt in a live Claude Code session.

### Slice 34: Storage: queries, events and indexes ([slice](slices/34-storage-queries.md))

- After the release, `wrangler d1 migrations list --remote` shows 0008 applied (read only).

### Slice 33: Doc sync never retypes live work, and checks and parts count right ([slice](slices/33-sync-and-checks-rules.md))

- After the release, the owner's next plan sync shows the same `checks_not_tried` count as the slice files, and a stale or blocked check shows muted under its slice.

### Slice 40: The plugin puts background agents into the step tree ([slice](slices/40-agents-in-tree.md))

- On the owner's machine, two background agents show as running child rows under the step that started them, and a helper's own steps appear under its row (no device run: plugin hook behaviour needs a real Claude Code session).

### Slice 39: Steps are a tree: sub-steps unfold in place, and several can run at once ([slice](slices/39-step-tree.md))

- On a phone and the deployed board, a real tree with helpers reporting `under_step` in parallel.
- The ring under reduced motion, on a real device.

### Slice 36: Board, Active and drawer pages: review leftovers ([slice](slices/36-board-page-fixes.md))

- On a phone, the board read stops one tick after leaving a page, and the Usage tab count reads the cached board.
- On a phone, the open drawer stays open through a reload.

### Slice 35: Usage page and cost figures: review leftovers ([slice](slices/35-usage-page-fixes.md))

- On a phone or desktop in a zone with daylight saving, the Usage page's bars, reset markers and labels line up across a clock change (next change: late March).

### Slice 32: Open questions are counted and kept right; `ask_human` can set `needs_you` ([slice](slices/32-questions-and-rules.md))

- A live `ask_human` from a chat sets `needs_you` on its card, after the release.

### Slice 42: A built slice whose checks are untried shows as built, not in progress ([slice](slices/42-built-not-in-progress.md))

- After the release and one `sync-docs` run, the live board shows built slices under Built, not in progress.
- A device look at the Built section on a phone.

### Slice 37: Access answers, ending a grant, and the setup page's leftovers ([slice](slices/37-access-and-grants.md))

- Key cool-down: see the Decision above (`guardedKeys` in `src/api/access.ts`).
- Claude checks in Chrome (owner, 2026-11-19: "open it with claude in chrome and check it"): the setup page lists the claude.ai grant; ending it and reconnecting works. First try 2026-11-19 00:30: the page never finished loading for the Chrome tools in 90 s, so it is still open.

### Slice 31: Plan sync and waiting cards read the documents and transcripts right ([slice](slices/31-sync-and-waiting-text.md))

- A real Notification hook run on the owner's machine opens a waiting card with masked text.
- A real plan sync from a repo with parked slices.

### Slice 30: The plugin's usage and cap scripts: review leftovers ([slice](slices/30-usage-script-fixes.md))

- A real session on the owner's machine sends cap readings after a plan switch with the address unusable.
- The `docs/setup/cloud.md` setup loop on a real cloud box.

### Slice 29: Session cards keep background agents' state right ([slice](slices/29-agent-state-fixes.md))

- On the owner's machine: one session with two parallel background agents. Both agents' steps show, the card closes after the last stops, and the title stays.

### Slice 28: Cloud and VM sessions report their usage under their own label ([slice](slices/28-cloud-usage.md))

- A real cloud session's usage shows on the usage page under its own label.
- The owner's main machine shows its new label after the plugin switch.
- The cloud records path `/root/.claude` is untried in a real cloud session.
- The setup-time variables (unset during the setup script) are untried.
- The Stop hook's detached send (`usage-tick` spawns a background run) is untried in a cloud VM.

### Slice 26: The "all kinds" cost figure stays steady across a weekly reset ([slice](slices/26-mix-after-reset.md))

- Live before/after figure across a weekly reset (work item 1): needs a data export replayed through `readUsage`.
- The page on the live board after the first weekly reset since this merged.

### Slice 27: Every "Needs you" card says what is needed, for which work, and why ([slice](slices/27-needs-you-cards.md))

- In a real Claude Code session with the plugin: an idle prompt after a status line opens no card; one after a question opens a card with that question; a permission prompt card names the tool and command.

### Slice 22: Token usage and cap readings from the plugin ([slice](slices/22-plugin-usage.md))

- In a real Claude Code session with the plugin installed, tokens reach the board and join the session card.
- With `report_usage` off no usage call goes out and the card stays live.
- With `read_plan_cap` on a cap reading arrives.
- That `CLAUDE_CONFIG_DIR` reaches the plugin's hooks (the fixer did not check Claude Code's docs).

### Slice 23: Plan documents sync, an optional plugin part ([slice](slices/23-plugin-plan-sync.md))

- A real sync against a live board from a qualifying repo with the plugin's script (`plugin/scripts/sync-docs.mjs`, git mode from `origin/main`).

### Slice 24: Set up your own board: a guide Claude follows ([slice](slices/24-own-board-guide.md))

- The Access step assumes the page is on a custom hostname and agents use the `workers.dev` address (how the live board was built); Access directly on `workers.dev` was not tried.
- That a Workers Builds token on a fresh account can run the D1 migrations in `deploy:ci` and provision the `OAUTH_KV` namespace on the first deploy ("created for you" in the guide); if the token lacks D1 edit the deploy fails with an auth error.
- A fresh Claude Code following the guide in a new Cloudflare account ends with a board that shows a test card.
- The dashboard menu path in `docs/setup/own-board.md` for editing the Workers Builds token (not checked).
- The guide's Workers Builds fields (branch `main`, no build command, `npm run deploy:ci`, previews off), taken from the Slice 1 record, not confirmed in docs.

### Slice 21: Session cards report themselves from the plugin's hooks ([slice](slices/21-plugin-session-cards.md))

- A real session with a background agent keeps its card open past a reply, then closes it.
- `plugin/hooks/hooks.json` exec form and the PostToolUse tool name `mcp__plugin_agent-board_agent-board__report_progress` not seen in a live session.
- On Windows, the hook's reminder JSON reaches the session whole (the check pass replaced `process.exit(0)` with `process.exitCode`; the truncation was never reproduced).
- In a live session an open question survives Stop and is cleared by the next prompt (UserPromptSubmit/PostToolUse close of waiting items, added by the check pass).

### Slice 20: A Claude Code plugin and a setup guide ([slice](slices/20-plugin-connect.md))

- A fresh Claude Code on another machine, given only the README sentence, connects and shows a card.
- Auto-update delivers a change to an installed client after a merge.
- Install from the GitHub marketplace source (`claude plugin marketplace add <owner>/<repo>`) with the plugin merged on `main`: tested only from a local path in a throwaway `CLAUDE_CONFIG_DIR`.
- The test card steps of `docs/setup/connect.md` (`report_progress`, `get_item`, `mark_done`) run by a Claude Code session, and the skill loading in a session (only the MCP connection was checked).
- The stdin-from-a-file form of `claude plugin configure --values-stdin` in `docs/setup/connect.md` step 4 was not run (only the pipe form was).

### Slice 19: The owner can get the chat instruction text without a token ([slice](slices/19-chat-text.md))

- A claude.ai chat opens a card on the board after the owner's paste of 2026-11-18 (the page loaded, and the owner copied and pasted the line and the text into claude.ai Instructions: "I've updated the instructions with the 2 texts"). Read it with `list_open` once the owner has used a chat for a piece of work; the owner is not asked to do anything for it.

### Slice 18: Every AI that connects to the board is told how to report ([slice](slices/18-agent-setup.md))

- Whether a claude.ai chat shows the server's instructions to the model. Check: a new chat with only the connector (no pasted text) opens a `my-chats` card. If it does, the owner's pasted instruction can be removed.

### Slice 16: Claude chat and Claude Design report to the board, and their use counts ([slice](slices/16-chat-reports.md))

- A claude.ai chat reports a card under "my-chats". The owner's two chats on 2026-11-17 reported nothing (owner: "I already tried the chat and I told you it did not do anything"), so the owner is not asked to repeat it.
- The same instruction in a Claude Design session (Claude Design calling the connector is unproven; see the first Work item). Asked of the owner only after Slice 19 is built.
- A real claude.ai chat reporting through the connector and the usage page's "Claude chat" row.
- Claude Design and custom connectors are unproven in the docs.
- The claude.ai settings path in `docs/clients.md` (*Claude chat*: Settings, "Your Claude", Instructions) was never read from the live site (feedback loop 2026-11-17-1826).

### Slice 15: One collapsible block per project, done work always folded ([slice](slices/15-project-blocks.md))

- The owner compares the deployed board on the phone and on the desktop with the mock (`BoardV2`, `BoardV2Dark`, `PhoneV2`, `PhoneV2Light`, `PhoneV2Drawer`, `StatesV2`).
- The "Other open items" group (not in the mock) is kept; the owner says whether to keep it.

### Slice 14: Untested checks live inside their slice, and problems get their own list ([slice](slices/14-checks-in-slice.md))

- On the deployed board after a real doc sync: no card per check, and the header total equals the count line in `plan.md` (needs the config repo's client to send `checks`).
- Migration 0007 is applied on the live D1 (`wrangler d1 migrations list --remote` showed none left at about 16:20Z on 2026-11-17); still to check: the `items` and `events` row counts survived its table rebuild (Slice 14 check pass #8, "confirm on real D1").
- The owner compares the deployed page with `BoardV2.dc.html` and `BoardV2Dark.dc.html`.

### Slice 13: A session card says what it is doing and what it needs ([slice](slices/13-session-cards.md))

- On the deployed board, a real session's goal and steps show within 5 minutes.
- On the deployed board, a question shows under Needs you with its text.
- On the deployed board, a stopped session leaves Working now at once.
- The owner's comparison of the deployed page with the mocks.
- The drawer history of a working card with several events, in a browser.
- The 1.5px border (renders as 1px in the browser run).
- The seeded question's drawer history shows each event once (the doubled row was fixed after the browser run and not re-run).

### Slice 11: Slice parts: progress bar on the slice, click through to the active part ([slice](slices/11-slice-parts.md))

- On the deployed board after a real document sync and a real agent run, a slice shows its bar and the click lands on the part the agent holds (needs the deploy and a client that sends parts).
- The follow link row on the phone tile (44 px row, text #E8EAEE) was not measured in the browser run.
- The 1.5 px circle border on a screen with pixel ratio 2 or more.

### Slice 10: Task steps and the active work page ([slice](slices/10-task-steps.md))

- The phone tile bar gap reads 2 px where the slice says "4 gap" (ambiguous).
- Dark desktop (no artboard).
- The loading blocks' colours and the failed card against the mock.
- On the deployed board: three tasks from a real client run show on the active page with the right step (Verification section).
- On the deployed board: a killed session leaves the page when it turns stale.

### Slice 9: What 1% of the cap costs, per model ([slice](slices/09-cap-cost-estimate.md))

- On the deployed board after some days of real reports: the estimate for a model that ran alone matches a hand calculation from the page's own numbers.
- Dark desktop values.
- Pixel-level chart marks.
- The page on the owner's phone.

### Slice 8: Usage reports: tokens per model, cap readings, usage page ([slice](slices/08-usage-reports.md))

- The deployed-board check in *Verification*: a real client run shows tokens for two models and the weekly percent (waits for the deploy and the client in the owner's config repo).
- Thinning from the live cron.
- The page on the owner's phone through Access, against the mock.

### Slice 5: OAuth so claude.ai can use the MCP server ([slice](slices/05-remote-mcp.md))

- The same question ("what's waiting for me on the agent progress board?") from the claude.ai app on a phone. Seen by the owner 2026-11-16: the connector added and the question answered in a claude.ai chat; the device was not said.
- A static bearer token with `public_origin` set and a different request host still gets through (check-2 finding 8).

### Slice 7: Stale detection ([slice](slices/07-stale-detection.md))

- The cron trigger registers on deploy and fires. Seen 2026-11-16: `wrangler.jsonc` declares one cron, `*/15 * * * *`. Not seen: its registration on the live Worker, or a firing.
- A killed session's item turns stale within the expiry and recovers on the next report, on the live board.
- The account's free-plan limit of 5 cron triggers is not exceeded.

### Slice 2: Tile board page ([slice](slices/02-tile-board.md))

- Seeded data shows correctly on the owner's phone, opened from the deployed URL through Access (drawer and waiting strip included). Seen 2026-11-15: the owner opened the page on the custom hostname from a phone, signed in through Access and said "it works on my phone"; what they saw was the leftover test items, not seeded data. Not seen: the seeded data, drawer and waiting strip on the phone.
- The custom domain is attached to the Worker and a pipeline deploy leaves it attached. Seen 2026-11-15: attached, resolves. Latest deployment seen 2026-11-16T13:02:51Z; not read that day: whether it is still attached after it.
- The first pipeline run of the new `deploy:ci` (`vite build`, then migrations, then deploy with `web/dist/agent_progress_board/wrangler.json`); locally `vite build` and `wrangler deploy --dry-run` passed. Seen 2026-11-15: the check "Workers Builds: agent-progress-board" on c1cc5de succeeded and the Worker is live with migrations applied. Not seen: the pipeline log.
- Worker secrets (`ACCESS_*`, `BOARD_CONFIG`) survive a pipeline deploy. Seen 2026-11-15: `BOARD_WRITE`/`BOARD_READ` tokens and the `OWNER_PASSPHRASE` page work after the deploy. Seen 2026-11-15: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set. Seen 2026-11-16: after the deployment of 13:02:51Z `wrangler secret list` shows `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `BOARD_READ_TOKEN`, `BOARD_WRITE_TOKEN` and `OWNER_PASSPHRASE`; `BOARD_CONFIG` is not set as a secret (it is optional).
- The seed script run against the deployed Worker. Note 2026-11-16: the live board now holds real items, so a seed run there would break the rule in `plan.md` (a check that writes to the live board writes a handful of rows and removes them in the same run); it needs a decision first.
- The Node version in `engines` (`>= 22.18.0`): the number comes from the review and the fixer's knowledge; context7 confirmed only that type stripping is default in Node 24.

### Slice 6: Reporting from Claude Code cloud sessions ([slice](slices/06-cloud-sessions.md))

- A slice built in a cloud session updates its tile; waits for the first deploy and the client
  in the owner's config repo.
- How a network secret reaches an outgoing request: read the docs' "Add network secrets"
  section and try it in one real cloud session (client author).

### Slice 3: Client handover: tool reference and client guide ([slice](slices/03-reporter.md))

- A client written only from the guide reports a real run and its tiles move live (waits for the first deploy and for the client in the owner's config repo).

