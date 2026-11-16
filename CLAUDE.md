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
  external-token hook, and OAuth callers are read-only. Never add a second auth path (Slice 5:
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
