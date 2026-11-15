### Slice 1 — Worker + D1 items store and write API

Source: the owner's phone scope "Agent Progress Board — online dashboard of work progress
across projects" (2026-11-15), milestone 1 and *First step*.

*Planned.*

**Touches:** `package.json`, `package-lock.json`, `tsconfig.json`, `wrangler.jsonc`,
`eslint.config.js`, `migrations/0001_items.sql`, `src/**`, `test/**`, `.dev.vars.example`,
`config/board.example.json`, `README.md`, `CLAUDE.md`

#### Why

The smallest end-to-end thing: a deployed Worker that stores items and returns the board
window, so every later slice (UI, reporter, doc sync, MCP) writes and reads through one contract.

#### Decisions

- One idempotent upsert keyed by a stable `key` (e.g. `<project>/slice-58`); REST, CLI and MCP
  all call the same domain function (`CLAUDE.md`, *One upsert contract*).
- `items` columns: `key` (PK), `project`, `parent_key`, `type`, `priority`, `status`, `title`,
  `why`, `details_md`, `links` (JSON array of `{label,url}`), `source`, `heartbeat_at`,
  `created_at`, `updated_at`, `done_at`. Append-only `events` table (`item_key`, `at`,
  `status`, `source`, `note`) for the detail view's history.
- Closed sets are enums: `type` (slice | problem | waiting_for_me | bug | unplanned),
  `status` (open | in_progress | blocked | done | stale), `priority` (P0–P3). Definitions of
  the types are in `plan.md`, *Decisions*.
- `done_at` is set when status becomes `done` and cleared when it leaves `done`; `created_at`
  never changes on an update.
- Board window query: `status != 'done' OR done_at > now - window`, default and max window
  from config (default 12h).
- Bearer token auth, two scopes: write token (PUT) and read token (GET). Tokens are Worker
  secrets, generated and recorded in the owner's private secrets store; never in the repo.
- Project list, type colours and labels come from config (`config/board.example.json` in the
  repo with made-up projects; the real config is a Worker var or secret, not committed).
- **Hard constraint:** no project names, hostnames, account ids or item data in the repo.
- Deploys only through Cloudflare Workers Builds on merge to `main`; D1 migrations applied by
  the build's deploy command, never `wrangler deploy` from a shell.

#### Work

- [ ] Query context7 for the current Wrangler, Workers TypeScript, D1 and Vitest
      (`@cloudflare/vitest-pool-workers`) setup, and re-check the free-tier limits of Workers,
      D1 and Access; write the limits that matter (requests/day, D1 rows read/written/day,
      storage) into this file.
- [ ] Scaffold the Worker (TypeScript, ESLint, Vitest in the Workers pool) with layered
      folders: `src/domain` (item types, enums, upsert rules), `src/application` (upsert,
      list window), `src/infrastructure` (D1 repository), `src/api` (routing, auth, validation).
- [ ] `migrations/0001_items.sql`: `items` and `events`, indexes on `(project)`, `(status)`,
      `(done_at)`.
- [ ] `PUT /items/:key`: validate the body (missing required field is 400 with problem
      details; unknown type/status/priority is 400), upsert, append an event when status
      changes, return the stored item.
- [ ] `GET /items?window=12h&project=`: open items plus items done inside the window,
      grouped-ready (sorted by project, then waiting_for_me first, then priority).
- [ ] `GET /items/:key` with its events (for the detail drawer).
- [ ] Auth middleware: write vs read token, constant-time compare, 401 without a token.
- [ ] Unit tests for the upsert rules and the window filter; integration tests through the
      Worker with a local D1.
- [ ] Generate the write and read tokens and save them in the secrets store; set them as
      Worker secrets.
- [ ] Create the D1 database and connect the repo to Workers Builds (by Cloudflare API with a
      token from the secrets store; a dashboard step only if no API covers it, then with a
      direct link). Deploy by merging.
- [ ] README: the item contract (fields, enums, the upsert and list endpoints, curl examples
      with a made-up project).

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.
- Against the deployed Worker: curl creates an item, updates it under the same key with no
  duplicate row, marks a second item done; `GET /items?window=12h` returns the open item and
  the done one; an item whose `done_at` is older than the window is not returned.
- A request with no token or the read token on PUT gets 401/403.
