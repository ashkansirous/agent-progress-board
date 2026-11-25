# agent-progress-board

Cloudflare Worker + D1 board of agent work progress. Plan: [plan.md](plan.md), slices in
`docs/plan/slices/`.

## Rules

- **Public repo, private data.** No project names, item data, hostnames, account ids or
  tokens in the repo. Item types, colours and projects come from config; examples use
  made-up projects. Secrets come from the secrets store, never a file in git. This covers
  `plan.md` and `docs/plan/` too: the client side is planned in the owner's private config
  repo, so never copy its paths, line numbers or the owner's other project names here.
- **Reporters fail open.** Any client that writes to the board (CLI, hook, skill) must never
  block or fail the caller: short timeout, swallow errors, exit 0.
- **One contract: MCP.** Every capability is an MCP tool on the one `/mcp` endpoint, and every
  tool calls the application layer (one upsert keyed by a stable `key`). No public REST write
  path; the board page's read route calls the same application functions.
  Clients for Claude Code live in `plugin/` (marketplace in `.claude-plugin/marketplace.json`); `docs/clients.md`
  is the guide for other clients. The reporting rules text exists once, in `src/mcp/instructions.ts`, mirrored
  between the BEGIN/END RULES markers of `plugin/skills/agent-board/SKILL.md` and held equal by
  `test/pluginRules.test.ts`; change both together. `plugin/` holds no owner data and no version (public repo)
  (Slice 20: docs/plan/slices/20-plugin-connect.md).
- **The design is in `docs/design/`.** Read every visual value (colour, size, spacing, copy)
  from those files ([README](docs/design/README.md)); never guess one and never fetch the
  design from outside the repo.
- **Read-mostly.** The board shows work; editing, assigning and planning stay in the repos.
- **No gate bypass.** The E2E page mode exists only under the env flag `playwright.config.ts`
  sets; never add a local or production path that skips the Access check in
  `src/api/access.ts` (Slice 2: docs/plan/slices/02-tile-board.md).
- **Deploys only through the pipeline** (merge to `main`), never `wrangler deploy` from a
  shell. A night's merges carry the skip marker and reach the Worker only through the batched release's deploy hook;
  which changed files count as a Worker change is `workerPaths` in `.claude/merge-gate.json`, so a new folder that
  changes what `npm run deploy:ci` builds is added there too (the first draft missed `config/**`; note
  docs/plan/notes/2026-11-17-2023-feedback-loop.md).

- **This repo has no PR checks.** There is no GitHub Actions workflow; the only check is Workers
  Builds on a push to `main`. Tell a merge agent "this repo has no PR checks" so it does not wait
  for one ([note](docs/plan/notes/2026-11-16-1402-feedback-loop.md)).

## Commands and layout

- `npm run lint`, `npm run typecheck`, `npm test` (Vitest in the Workers pool, local D1).
- Layers: `src/domain` (pure rules), `src/application` (use cases, repository port),
  `src/infrastructure` (D1), `src/mcp` (tools, schemas), `src/api` (routing, auth). Tools hold
  no rules.
- A second `npm run test:e2e` alongside another worktree's sets `E2E_PORT` (e.g. 4174); runs never reuse a server and a
  busy port fails at start. Scratch files go under `tmp/`, which lint ignores (Slice 17:
  docs/plan/slices/17-test-isolation.md).
- `npm run test:e2e` (Playwright, headless, faked `/api/board`), `npm run dev`. `web/` is the
  page (string table, palette from config), `e2e/` the Playwright tests, `scripts/seed.ts` the
  seed script (Slice 2: docs/plan/slices/02-tile-board.md).
- TypeScript is pinned to 6.0.x: typescript-eslint 8.72 rejects 7.x as a peer. Vitest uses
  `@cloudflare/vitest-plugin` (the renamed pool), not `@cloudflare/vitest-pool-workers`.
- MCP is stateless: a new `McpServer` and transport per request, no sessions, no Durable
  Objects. See [Slice 1](docs/plan/slices/01-items-api.md) *Decisions*.
- Auth on `/mcp` runs through the OAuth provider in `src/api/oauth`; bearer tokens enter by its
  external-token hook, and every OAuth-issued token is the owner's write scope without `sync_snapshot`
  (`scopeOfCaller` in `src/api/oauth/provider.ts`, the one mapping; `allows` in `src/domain/scope.ts`).
  Never add a second auth path (Slice 16: docs/plan/slices/16-chat-reports.md; Slice 5:
  docs/plan/slices/05-remote-mcp.md).
- The default export in `src/index.ts` stays a plain object with `fetch` and `scheduled`
  (Slice 5: docs/plan/slices/05-remote-mcp.md).
- The stale rule exists twice: `isExpired` in `src/domain/stale.ts` and the `EXPIRED_ROWS` SQL in
  `src/infrastructure/d1Repository.ts`. `test/stale.test.ts` holds them equal; change both
  (Slice 7: docs/plan/slices/07-stale-detection.md).
- Usage state is derived at read: the tables hold only what was reported; windows, verdicts and restarts come from
  `src/domain/cap.ts` and `src/domain/usage.ts`; never store a derived value (Slice 8:
  docs/plan/slices/08-usage-reports.md).
- Every stored time is normalised to UTC ISO in the application layer; `SAMPLES_FROM` and `THIN_ROWS` rely on it and
  `test/usageTools.test.ts` asserts their query plans (Slice 8: docs/plan/slices/08-usage-reports.md).
- Cap cost is derived at read: the fit in `src/domain/capCost.ts` runs per request on the full
  history and is bounded (round caps at the top of the file, timing test in
  `test/capCost.test.ts`); never store weights or multipliers (Slice 9:
  docs/plan/slices/09-cap-cost-estimate.md).
- A cost that includes a model with no fitted weight is null (dash), never 0 (Slice 9:
  docs/plan/slices/09-cap-cost-estimate.md).
- "Working now" is one rule, `isWorkingNow` in `src/domain/steps.ts`, which uses `isHeartbeatExpired` from
  `src/domain/stale.ts`; never add another copy (Slice 10: docs/plan/slices/10-task-steps.md).
- The open item's address is `#/open/<key>` and the drawer follows the address (Slice 10:
  docs/plan/slices/10-task-steps.md).
- Parts come from the documents (`in_doc_sync`); only those count in a slice's list and bar. The rule is in
  `src/domain/parts.ts` (Slice 11: docs/plan/slices/11-slice-parts.md).
- The shown status of a slice with an active part is derived at read (`shownStatusOf`), never stored (Slice 11:
  docs/plan/slices/11-slice-parts.md).
- The Worker returns `parent_slice` as data; the page builds the text (Slice 11: docs/plan/slices/11-slice-parts.md).
- Session expiry is `SESSION_AGENT` / `SESSION_STALE_AFTER_MINUTES` in `src/domain/stale.ts`, kept equal to
  `EXPIRED_ROWS` by `test/stale.test.ts`; change both together (Slice 13: docs/plan/slices/13-session-cards.md).
- The question-clearing rule lives only in `answersQuestion` in `src/domain/upsert.ts`; never copy it
  (Slice 13: docs/plan/slices/13-session-cards.md).
- The board's grouping rule is one function, `groupBoard` in `src/domain/boardGroups.ts`; the page never regroups
  (Slice 14: docs/plan/slices/14-checks-in-slice.md).
- Item validation (key prefix, parent in the same project, check needs a slice parent, at most 100 checks) is one
  function, `itemProblem` in `src/domain/checks.ts`, used by `sync_snapshot` (skips the item, returns `skipped`) and
  `report_progress` (refuses); never add a second copy (Slice 14: docs/plan/slices/14-checks-in-slice.md).
- The fold rule lives only in `resolveOpen` (`web/src/foldRules.ts`); the page never regroups: the order of
  "Needs you" comes from the server's `needs_you` (Slice 15: docs/plan/slices/15-project-blocks.md).
- Chat and Design growth is placed only in `placeInWindows` in `src/domain/capCost.ts`; the windows are derived at
  read from session cards, never stored (Slice 16: docs/plan/slices/16-chat-reports.md).
- The reporting rules an MCP client receives are one constant, `SERVER_INSTRUCTIONS` in `src/mcp/instructions.ts`,
  built from the domain constants; `docs/clients.md` tells chat users to copy it from the `initialize` result, never a
  hand copy (Slice 18: docs/plan/slices/18-agent-setup.md).
- The chat instruction text reaches the owner only through `GET /api/chat-text` behind the Access check
  (`src/api/chatText.ts`), read from `SERVER_INSTRUCTIONS` and `CHAT_PREFACE`; never a hand copy in `web/` or docs
  (Slice 19: docs/plan/slices/19-chat-text.md).
- The e2e output folder is per port (`test-results/<port>` in `playwright.config.ts`), so two suites can run at once,
  even in one worktree. Loading-delay tests use the shared clock helper `e2e/loadingClock.ts` (clock installed before
  `goto`, the 500 ms timer counted per action); never a wall-clock wait (Slice 38:
  docs/plan/slices/38-steady-browser-tests.md).
- A done slice with at least one open check is Built: `BOARD_WHERE` in `src/infrastructure/d1Repository.ts` keeps it on
  the board, `groupBoard` in `src/domain/boardGroups.ts` derives the `built` list, and nothing about it is stored (Slice 42:
  docs/plan/slices/42-built-not-in-progress.md).
- The key cool-down lives only in `guardedKeys` in `src/api/access.ts`: it classifies by where the error came from (the key getter), 10 s, never by an allowlist of error classes (Slice 37: docs/plan/slices/37-access-and-grants.md).
- "All kinds" weighting while the current weekly window is under 24 hours old uses the last full window's mix, chosen only
  by `chooseMixWindow` in `src/domain/capCost.ts`; `mix_source` is derived at read, never stored, and the page never picks
  the window (Slice 26: docs/plan/slices/26-mix-after-reset.md).
- Unlabelled usage rows are folded into the busiest named environment at read (`withBaseEnvironment` in
  `src/application/usage.ts`, pinned by `usage.baseEnvironment`); a machine must be named before any other environment
  is, and the "No label (main machine)" string shows only while none is named (Slice 28: docs/plan/slices/28-cloud-usage.md).
- The usage buckets are built once, in real time, by `bucketsBetween` in `src/domain/usage.ts`; the page draws the
  Worker's `{key, start, end}` list as sent and never rebuilds it, and positions come from `xOfMoment`. Every surface
  asks one offset rule, `offsetForZone`, for the zone's offset at each moment (Slice 35:
  docs/plan/slices/35-usage-page-fixes.md).
- `list_open` and `get_item` replies are cut at 50,000 characters (Claude Code's own text-result limit) only by
  `cutReply` in `src/mcp/tools.ts`; it never clips ids or times, and its note names the first dropped key. Never add a
  second cut (Slice 32: docs/plan/slices/32-questions-and-rules.md).
- The board's loading state ends only through `settle()` in `web/src/boardStore.ts`; never write `loading` or `slow`
  anywhere else (Slice 36: docs/plan/slices/36-board-page-fixes.md).
- Every write of `items.steps` goes through `saveStepsReport` in `src/application/board.ts` (compare-and-swap); never add a
  second write path (Slice 39: docs/plan/slices/39-step-tree.md).
- Step ids are resolved only by `resolveIds` in `src/domain/steps.ts`; never generate or reuse ids elsewhere (Slice 39:
  docs/plan/slices/39-step-tree.md).
- The event insert is bound to its own write by `changes() > 0` in `src/infrastructure/d1Repository.ts`; keep the two
  statements adjacent in the batch (Slice 39: docs/plan/slices/39-step-tree.md).
- What a check shows and counts is `isShownCheck` / `isCountedCheck` in `src/domain/checks.ts`; `OPEN_CHECK_OF` in
  `src/infrastructure/d1Repository.ts` is built from the counted statuses; never a third copy. Retyping a live key is
  refused only in `itemProblem` (Slice 33: docs/plan/slices/33-sync-and-checks-rules.md).
- A status report applies only when its time is at or after `live_status_at` (`NEXT_STATUS` in
  `src/infrastructure/d1Repository.ts`); `heartbeat_at` and `updated_at` keep the later time. A status-less report moves
  `live_status_at` only when it revives, with the same condition. Never compare a status with `heartbeat_at` (Slice 34:
  docs/plan/slices/34-storage-queries.md).
- The waiting-card close rule (no slice or part parent, not doc-synced, 24 h) exists twice: `isWaitingClosable` in
  `src/domain/stale.ts` and the cron query `WAITING_ROWS` in `src/infrastructure/d1Repository.ts`. `test/stale.test.ts`
  holds them equal; change both (Slice 34: docs/plan/slices/34-storage-queries.md).
- `SYNC_EVENT` is bound by `changes() > 0` and kept adjacent to its upsert, like `INSERT_EVENT`; never insert an event
  outside that binding (Slice 34: docs/plan/slices/34-storage-queries.md).
- A working card is an in_progress (or stale) item with an outcome, or agent "session": one rule, `isSessionItem` in
  `web/src/cards.ts`; never a second copy (Slice 41: docs/plan/slices/41-tasks-with-outcome.md).
- An owner step (a waiting item from `ownerItem` with no `needs_you`) is recognised only by `isOwnerStep` in
  `web/src/cards.ts`; never a second copy (Slice 43: docs/plan/slices/43-owner-cards-read-right.md).
- `<board address>` is resolved only at read on the page (`resolveBoardAddress` / `fillBoardAddress`), never stored: the
  host name stays out of the repo and the items (Slice 43: docs/plan/slices/43-owner-cards-read-right.md).
- The owner-step title rule (`**You:** <action> | <steps>` into `Slice N: <action>` plus details) lives only in `ownerTitleFields` in `plugin/scripts/sync-docs.mjs`; the card's steps text only in `ownerStepDetails` in `web/src/cards.ts`. The page has one string table (English) and no locale picking (Slice 44:
  docs/plan/slices/44-english-only-owner-steps.md).
- A doc-synced waiting item's `details_md` follows the document line: a non-null value replaces it, null clears it. The rule is `detailsOf` in `src/domain/docSync.ts` (Slice 45: docs/plan/slices/45-night-1602-follow-ups.md).
- Board freshness after a page arrival is `isFreshLoad` / `isFreshData` in `web/src/boardState.ts`, from the `settles`
  count; never a time-based reuse window (Slice 47: docs/plan/slices/47-open-follow-ups.md).
- The archive rules (what an archive takes, what revives, the purge, an archived parent's time passed to its doc-synced rows) live in the write statements of `src/infrastructure/d1Repository.ts` (`ARCHIVE_ROWS`, `SYNC_UPSERT`, `SYNC_REVIVE`, `UPSERT_ITEM`, `PURGE_*`), never on an earlier read (Slice 50: docs/plan/slices/50-batch-and-archive.md).
- The archive filters live in `BOARD_WHERE`, `EXPIRED_ROWS`, `WAITING_ROWS`, `OPEN_CHECK_OF` and `SESSION_WINDOWS`, and in their twins in `src/domain/stale.ts`; a new read of items adds `archived_at IS NULL` (Slice 50: docs/plan/slices/50-batch-and-archive.md).
- The 30 days are `ARCHIVE_KEEP_DAYS` in `src/domain/archive.ts`; never write the number elsewhere (Slice 50: docs/plan/slices/50-batch-and-archive.md).
- `docHash` has one board copy (`src/domain/docSync.ts`) and one plugin copy (`plugin/scripts/sync-docs.mjs`), held equal by `test/docHash.test.ts` and the plugin's vectors test; change both (Slice 50: docs/plan/slices/50-batch-and-archive.md).
- The step-time source precedence (observed, reported, stamped) lives only in `betterTime` in `src/domain/steps.ts`, used by `saveStepsReport`; never compare sources elsewhere (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- "A step is blocked on the owner" is one rule, `ownerBlockedSteps` in `src/domain/stepTypes.ts`; never a second copy (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- A hook report's (`source: "hook"`) children rule is one function, `hookStepsInput` in `src/domain/steps.ts`: the hook owns only `agent-` rows and its step list is the whole list (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- The done-slice keep rule (a done slice with a counted check stays done in doc sync) is `keepsDoneForChecks` in `src/domain/docSync.ts` (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
- Blocked colours come from the config palette (`needFg` / `bugFg` families), never a literal (Slice 51: docs/plan/slices/51-blocked-steps-true-times.md).
