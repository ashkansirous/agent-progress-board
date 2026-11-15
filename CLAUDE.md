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
- **Deploys only through the pipeline** (merge to `main`), never `wrangler deploy` from a
  shell.

## Commands and layout

- `npm run lint`, `npm run typecheck`, `npm test` (Vitest in the Workers pool, local D1).
- Layers: `src/domain` (pure rules), `src/application` (use cases, repository port),
  `src/infrastructure` (D1), `src/mcp` (tools, schemas), `src/api` (routing, auth). Tools hold
  no rules.
- TypeScript is pinned to 6.0.x: typescript-eslint 8.72 rejects 7.x as a peer. Vitest uses
  `@cloudflare/vitest-plugin` (the renamed pool), not `@cloudflare/vitest-pool-workers`.
- MCP is stateless: a new `McpServer` and transport per request, no sessions, no Durable
  Objects. See [Slice 1](docs/plan/slices/01-items-api.md) *Decisions*.
