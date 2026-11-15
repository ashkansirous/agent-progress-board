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
- **One upsert contract.** REST, CLI and MCP all go through the same item upsert keyed by a
  stable `key`; never add a second write path with its own rules.
- **Read-mostly.** The board shows work; editing, assigning and planning stay in the repos.
- **Deploys only through the pipeline** (merge to `main`), never `wrangler deploy` from a
  shell.
