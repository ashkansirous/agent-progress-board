### Slice 1 — Worker + D1 items store behind an MCP endpoint

Source: the owner's phone scope "Agent Progress Board — online dashboard of work progress
across projects" (2026-11-15), milestone 1 and *First step*; changed at the desk the same day:
the owner decided the board exposes **everything through MCP**, and building clients is the
job of the repos that want one (see [Slice 3](03-reporter.md)).

*In progress (wave 2026-11-15), draft PR.*

**Migrations:** 0001

**Touches:** `package.json`, `package-lock.json`, `tsconfig.json`, `wrangler.jsonc`,
`eslint.config.js`, `migrations/0001_items.sql`, `src/**`, `test/**`, `.dev.vars.example`,
`config/board.example.json`, `README.md`, `CLAUDE.md`

#### Why

The smallest end-to-end thing: a deployed Worker that stores items and answers MCP tool calls,
so every client (Claude Code hooks, skills, cloud sessions, claude.ai, anyone else's agent)
writes and reads through one contract from day one.

#### Decisions

- **MCP is the public contract.** One remote MCP endpoint (`/mcp`, Streamable HTTP) with bearer
  auth. Tools in this slice:
  - `report_progress` — the idempotent upsert of one item by its stable `key`
    (e.g. `<project>/slice-58`);
  - `mark_done` — set an item done;
  - `ask_human` — create or update a `waiting_for_me` item;
  - `list_open` — the board window (open items plus items done inside the window), filterable
    by project and type;
  - `get_item` — one item with its event history.
  Later slices add `sync_snapshot` (Slice 4). No public REST write path; the board page's
  read route (Slice 2) calls the same application functions.
- Every tool calls the application layer; no tool holds its own rules (`CLAUDE.md`,
  *One contract*). A plain HTTPS POST of an MCP `tools/call` request works too, so clients
  that can't load an MCP server (cloud sessions, hooks) use the same endpoint.
- Stateless MCP (no sessions, no Durable Objects) unless the library requires otherwise;
  decide after the context7 check and write the reason here.
- **Board mock (2026-11-15, [Slice 2](02-tile-board.md) *Design*):** the tile shows the parent
  as display text ("Plan · Search", "Wave 3", "Slice 4 · Tag search"), which is often not an
  item. So the `items` column `parent_key` is replaced by `parent`, a free text label (the
  mock supersedes `parent_key`); `report_progress`, `ask_human` and `sync_snapshot` take
  `parent` as text. `ask_human` also takes `priority`, `why`, `details_md` and `links`, like
  `report_progress`, so a waiting tile has everything the mock shows. A report that changes
  nothing but the heartbeat writes an event with the note "Heartbeat" (the mock's history
  shows these); the caller's `note` replaces it when given. `list_open` and `get_item` return
  `created_at`, `updated_at`, `done_at`, `heartbeat_at` and the events (newest first, latest
  20 on `list_open`, all on `get_item`); the page derives "Asked 25 min ago", "Done 2 h ago"
  and "No heartbeat for 3 h" from them.
- `items` columns: `key` (PK), `project`, `parent`, `type`, `priority`, `status`, `title`,
  `why`, `details_md`, `links` (JSON array of `{label,url}`), `source`, `heartbeat_at`,
  `created_at`, `updated_at`, `done_at`. Append-only `events` table (`item_key`, `at`,
  `status`, `source`, `note`) for the history.
- Closed sets are enums: `type` (slice | problem | waiting_for_me | bug | unplanned),
  `status` (open | in_progress | blocked | done | stale), `priority` (P0–P3). Type definitions
  are in `plan.md`, *Decisions*.
- `done_at` is set when status becomes `done` and cleared when it leaves `done`; `created_at`
  never changes on an update.
- Board window: `status != 'done' OR done_at > now - window`, default and max from config
  (default 12h).
- Two token scopes: write (all tools) and read (`list_open`, `get_item` only); a read token
  calling a write tool gets an MCP error, no write. Tokens are Worker secrets, generated and
  recorded in the owner's private secrets store; never in the repo.
- Invalid input (missing field, unknown enum value) returns a tool error naming the field;
  nothing is written.
- Project list, type colours and labels come from config (`config/board.example.json` with
  made-up projects; the real config is a Worker var or secret, not committed).
- **Hard constraint:** no project names, hostnames, account ids or item data in the repo.
- Deploys only through Cloudflare Workers Builds on merge to `main`; D1 migrations applied by
  the build's deploy command, never `wrangler deploy` from a shell.

#### Work

- [ ] Query context7 for the current Wrangler, Workers TypeScript, D1, Vitest
      (`@cloudflare/vitest-pool-workers`) setup and the remote MCP server options on Workers
      (Cloudflare Agents SDK `createMcpHandler` / `McpAgent`, the MCP TypeScript SDK's
      Streamable HTTP transport); re-check the free-tier limits of Workers, D1 and Access and
      write the ones that matter here.
- [ ] Scaffold the Worker (TypeScript, ESLint, Vitest in the Workers pool) with layered
      folders: `src/domain` (item types, enums, upsert rules), `src/application` (upsert,
      mark done, list window, get), `src/infrastructure` (D1 repository), `src/mcp` (tool
      definitions and schemas), `src/api` (routing, auth).
- [ ] `migrations/0001_items.sql`: `items` and `events`, indexes on `(project)`, `(status)`,
      `(done_at)`.
- [ ] The five tools above, each with an input schema and tests (including `parent` as text,
      the heartbeat event note and the events on `list_open`).
- [ ] Bearer auth with the two scopes, constant-time compare, 401 without a token.
- [ ] Unit tests for the upsert rules and the window filter; integration tests calling the
      MCP endpoint against a local D1.
- [ ] Generate the write and read tokens, save them in the secrets store, set them as Worker
      secrets.
- [ ] Create the D1 database and connect the repo to Workers Builds (by Cloudflare API with a
      token from the secrets store; a dashboard step only if no API covers it, then with a
      direct link). Deploy by merging.
      **Answered 2026-11-15:** the owner approved these setup steps for unattended runs
      (creating the D1 database and a KV namespace with wrangler, generating the tokens into
      the secrets store, `wrangler secret put`, connecting Workers Builds by API) and is adding
      the auto-mode allow line for them. The secrets store holds no Cloudflare token that can
      edit; the machine's wrangler login can create D1 and KV and write Worker secrets (scopes
      checked 2026-11-15; `wrangler` is not on PATH, run it with `npx wrangler`). If the
      Workers Builds connection cannot be made with that login, park only that step with the
      direct dashboard link; never `wrangler deploy` from a shell.
- [ ] README: the tool reference (names, inputs, outputs, enums, key format) and a curl
      example of a `tools/call` with a made-up project.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.
- Against the deployed Worker: `report_progress` creates an item, a second call with the same
  key updates it with no duplicate row, `mark_done` closes a second item, `list_open` returns
  the open item and the done one, and an item done longer ago than the window is not returned.
- The same calls work from Claude Code with the server added (`claude mcp add --transport http`)
  and from curl as a plain POST.
- No token gets 401; the read token calling `report_progress` gets an error and writes nothing.
