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
- **Plugin scripts.** Hooks and the reporter CLI live in `plugin/scripts`; every script fails open (exit 0, short
  timeout), keeps state only in `CLAUDE_PLUGIN_DATA`, and its tests run with `npm test`
  (`node --test plugin/**/*.test.mjs`) (Slice 21: docs/plan/slices/21-plugin-session-cards.md).
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
- Plugin usage options: `report_usage` (default true, token counts), `read_plan_cap` (default false; reads Claude
  Code's sign-in file for the plan cap, needs `report_usage` on) and `environment`. The cap reading stays opt-in.
  The usage scripts in `plugin/scripts` keep state only in `CLAUDE_PLUGIN_DATA` (Slice 22:
  docs/plan/slices/22-plugin-usage.md).
- The park-reason rule (which `parked:` reasons give a blocked slice and no waiting card) lives only in
  `waitsOnlyOnWork` in `plugin/scripts/sync-docs.mjs`; `plugin/skills/agent-board/SKILL.md` describes it in words,
  so change the function and the words together (Slice 23: docs/plan/slices/23-plugin-plan-sync.md).
- The chat instruction text reaches the owner only through `GET /api/chat-text` behind the Access check
  (`src/api/chatText.ts`), read from `SERVER_INSTRUCTIONS` and `CHAT_PREFACE`; never a hand copy in `web/` or docs
  (Slice 19: docs/plan/slices/19-chat-text.md).
- A waiting card from the plugin's Notification hook opens only when something is asked (permission, elicitation, or an
  idle prompt after a question); its text is masked by `maskSecrets` in `plugin/scripts/hooks/waiting-card.mjs` before it
  leaves the machine; never send transcript text unmasked (Slice 27: docs/plan/slices/27-needs-you-cards.md).
- "All kinds" weighting while the current weekly window is under 24 hours old uses the last full window's mix, chosen only
  by `chooseMixWindow` in `src/domain/capCost.ts`; `mix_source` is derived at read, never stored, and the page never picks
  the window (Slice 26: docs/plan/slices/26-mix-after-reset.md).
- Unlabelled usage rows are folded into the busiest named environment at read (`withBaseEnvironment` in
  `src/application/usage.ts`, pinned by `usage.baseEnvironment`); a machine must be named before any other environment
  is, and the "No label (main machine)" string shows only while none is named (Slice 28: docs/plan/slices/28-cloud-usage.md).
- Cloud sessions load no plugin; `docs/setup/cloud.md` runs the plugin's usage scripts from a pinned download, so a
  change to those script paths or imports must be mirrored there (Slice 28: docs/plan/slices/28-cloud-usage.md).
- Plugin hook state needs no lock: one stop file per agent id under `<id>.stopped/`, and goal-file writes re-read and merge
  only their own fields, then rename (`plugin/scripts/hooks/hook-input.mjs`); never add a read-modify-write of a shared
  state file. No hook sends title or why on a session card (Slice 29: docs/plan/slices/29-agent-state-fixes.md).
- `planSince` in `plugin/scripts/cap-reading.mjs` is the one plan-guard rule: a status-line file is sent only when it was
  written after the plan was first seen. Never guard on the board's last accepted plan (Slice 30:
  docs/plan/slices/30-usage-script-fixes.md).
