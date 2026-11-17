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
  path; the board page's read route calls the same application functions. Clients live in
  the repos that use them, not here; `docs/clients.md` is their guide.
- **The design is in `docs/design/`.** Read every visual value (colour, size, spacing, copy)
  from those files ([README](docs/design/README.md)); never guess one and never fetch the
  design from outside the repo.
- **Read-mostly.** The board shows work; editing, assigning and planning stay in the repos.
- **No gate bypass.** The E2E page mode exists only under the env flag `playwright.config.ts`
  sets; never add a local or production path that skips the Access check in
  `src/api/access.ts` (Slice 2: docs/plan/slices/02-tile-board.md).
- **Deploys only through the pipeline** (merge to `main`), never `wrangler deploy` from a
  shell.

- **This repo has no PR checks.** There is no GitHub Actions workflow; the only check is Workers
  Builds on a push to `main`. Tell a merge agent "this repo has no PR checks" so it does not wait
  for one ([note](docs/plan/notes/2026-11-16-1402-feedback-loop.md)).

## Commands and layout

- `npm run lint`, `npm run typecheck`, `npm test` (Vitest in the Workers pool, local D1).
- Layers: `src/domain` (pure rules), `src/application` (use cases, repository port),
  `src/infrastructure` (D1), `src/mcp` (tools, schemas), `src/api` (routing, auth). Tools hold
  no rules.
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
