# Not yet verified

Every open "Not yet verified" check, one block per slice. A check that passes, or that the
owner confirms, is removed here and its slice marked `verified`.

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
- German locale on the page.
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

