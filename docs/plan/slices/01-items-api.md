### Slice 1 — Worker + D1 items store behind an MCP endpoint

Source: the owner's phone scope "Agent Progress Board — online dashboard of work progress
across projects" (2026-11-15), milestone 1 and *First step*; changed at the desk the same day:
the owner decided the board exposes **everything through MCP**, and building clients is the
job of the repos that want one (see [Slice 3](03-reporter.md)).

*Built 2026-11-15, merged 2026-11-15 as PR #31. 33 tests; lint, typecheck and test green. Workers Builds is connected (2026-11-15) but the first deploy has not run yet; nothing is checked against a deployed Worker yet.* (Update 2026-11-15: deployed at c1cc5de; the curl checks passed, two pipeline checks have indirect evidence only, see *Not yet verified*.)

*Park note (2026-11-15; the feedback loop moved the row back to `planned` so the next run retries): the code is built and merged (PR #31). What is left is the first deploy and the checks against the deployed Worker. Workers Builds is connected; no build had run at 16:39Z on 2026-11-15 (`wrangler deployments list`).*

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
- **Stateless MCP, decided (2026-11-15, context7 and installed source):** MCP TypeScript SDK
  1.32.2 `McpServer` plus `WebStandardStreamableHTTPServerTransport` with
  `sessionIdGenerator: undefined` and `enableJsonResponse: true`, built per request. The library
  does not require sessions: with no session id generator the transport skips session
  validation, so a bare `tools/call` without `initialize` works (proved by a test), which is what
  plain-POST clients (hooks, cloud sessions) need; a Durable Object would add cost and state for
  nothing, since every tool is one D1 round trip. The POST must send
  `Accept: application/json, text/event-stream`. Rejected: Agents SDK `createMcpHandler`
  (needs SDK v2 and a large peer tree for no gain here).
- **Toolchain facts (settled by the installed packages):** `readD1Migrations` is imported from
  `@cloudflare/vitest-plugin`, `applyD1Migrations` from `cloudflare:test`; TypeScript is pinned
  to 6.0.3 because typescript-eslint 8.72.2 allows `<6.1.0` only; zod 4.6.7 works with SDK
  1.32.2 raw-shape schemas.
- **Free-tier limits that matter:** Workers Free 100,000 requests/day and 10 ms CPU per
  request; D1 Free 5,000,000 rows read and 100,000 rows written per day, 5 GB total. A board
  with a few agents stays far inside them. Access seat limit not confirmed.
- Config (`BOARD_CONFIG`, one JSON var, optional): window `default_hours` (12) and `max_hours`
  (72), plus `projects` and `types` for the board page; examples in
  `config/board.example.json`. `window_hours` on `list_open` is capped at `max_hours`.
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
- **Decided while building (2026-11-15):**
  - (a) `wrangler.jsonc` carries no `database_id`; wrangler resolves the database by
    `database_name`. Proved for migrations: `wrangler d1 migrations list DB --remote` found the
    remote database with no id. For `wrangler deploy` it is read from the wrangler source via
    context7, not yet run. Review disagreed: high finding 5 asked to keep the id out of the public
    repo (CLAUDE.md: no account ids), medium finding 4 asked to put it back (a deploy could
    provision a second empty database). The id stays out; D1 names are unique per account, so no
    second database can appear.
  - (b) A repeat `ask_human` on a done item reopens it: agents mark items done, the board is
    read-mostly (`CLAUDE.md`), so a repeat ask must show on the board. `ask_human` on a key of
    another type is a tool error, not a silent type change.
  - (c) `null` clears an optional field, omitted keeps it, an empty string is an error.
  - (d) A write is one atomic SQL upsert with `RETURNING`; SQL owns the upsert rules, so there is
    no read-modify-write window.
  - (e) A bad `BOARD_CONFIG` falls back to the defaults and never fails a write; window hours are
    capped at one year.
  - (f) TypeScript is pinned to 6.0.3 (typescript-eslint 8.72.2 peer range).

#### Work

- [x] Query context7 for the current Wrangler, Workers TypeScript, D1, Vitest
      (`@cloudflare/vitest-pool-workers`) setup and the remote MCP server options on Workers
      (Cloudflare Agents SDK `createMcpHandler` / `McpAgent`, the MCP TypeScript SDK's
      Streamable HTTP transport); re-check the free-tier limits of Workers, D1 and Access and
      write the ones that matter here.
- [x] Scaffold the Worker (TypeScript, ESLint, Vitest in the Workers pool) with layered
      folders: `src/domain` (item types, enums, upsert rules), `src/application` (upsert,
      mark done, list window, get), `src/infrastructure` (D1 repository), `src/mcp` (tool
      definitions and schemas), `src/api` (routing, auth).
- [x] `migrations/0001_items.sql`: `items` and `events`, indexes on `(project)`, `(status)`,
      `(done_at)`.
- [x] The five tools above, each with an input schema and tests (including `parent` as text,
      the heartbeat event note and the events on `list_open`).
- [x] Bearer auth with the two scopes, constant-time compare, 401 without a token.
- [x] Unit tests for the upsert rules and the window filter; integration tests calling the
      MCP endpoint against a local D1.
- [x] Generate the write and read tokens, save them in the secrets store, set them as Worker
      secrets. Done 2026-11-15 by the coordinator: `BOARD_WRITE_TOKEN` and `BOARD_READ_TOKEN`
      generated into the owner's secrets store and set with `wrangler secret put` (this created
      the Worker as an empty placeholder); the Worker's secret list read back shows both.
- [x] Create the D1 database. Done 2026-11-15 by the coordinator with wrangler: database
      `agent-progress-board`.
- [x] Connect the repo to Workers Builds (by Cloudflare API with a token from the secrets store;
      a dashboard step only if no API covers it, then with a direct link). Deploy by merging.
      **Parked 2026-11-15:** the Cloudflare API `/accounts/<id>/builds/*` with the machine's
      wrangler login returned 403 "Authentication error" (code 10000); the login has no Workers
      Builds scope, the secrets store has only read-only Cloudflare tokens and the repo has no
      GitHub secrets. See *Waiting on the user*.
      **Answered 2026-11-15:** the owner approved these setup steps for unattended runs
      (creating the D1 database and a KV namespace with wrangler, generating the tokens into
      the secrets store, `wrangler secret put`, connecting Workers Builds by API) and is adding
      the auto-mode allow line for them. The secrets store holds no Cloudflare token that can
      edit; the machine's wrangler login can create D1 and KV and write Worker secrets (scopes
      checked 2026-11-15; `wrangler` is not on PATH, run it with `npx wrangler`). If the
      Workers Builds connection cannot be made with that login, park only that step with the
      direct dashboard link; never `wrangler deploy` from a shell.
      **Done 2026-11-15:** the starter session connected it in the dashboard after the owner
      authenticated on GitHub, and read it back at 16:02Z from the Worker's settings page:
      production branch `main`, no build command, deploy command `npm run deploy:ci`, preview
      builds off. As reported by the starter session; the housekeeping session could not read the
      connection itself (the machine's Cloudflare login has no Workers Builds scope).
- [x] README: the tool reference (names, inputs, outputs, enums, key format) and a curl
      example of a `tools/call` with a made-up project.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.
- Against the deployed Worker: `report_progress` creates an item, a second call with the same
  key updates it with no duplicate row, `mark_done` closes a second item, `list_open` returns
  the open item and the done one, and an item done longer ago than the window is not returned.
- The same calls work from Claude Code with the server added (`claude mcp add --transport http`)
  and from curl as a plain POST.
- No token gets 401; the read token calling `report_progress` gets an error and writes nothing.

#### Waiting on the user

- ~~**Connect the repo to Workers Builds**~~ Done 2026-11-15 by the starter session (see the work
  item above); no longer waiting on the owner. No build has run yet: `wrangler deployments list`
  at 16:33Z on 2026-11-15 shows only the upload and three "Secret Change" deployments (newest
  16:24Z). The first build needs a push to `main` without the skip-CI marker, or the Worker's
  deploy hook; the starter session starts it after the night's last merge. It holds every
  deployed-Worker check in this and the later slices. **Update 2026-11-15:** the first build ran on the
  merge commit of PR #47 (c1cc5de) and succeeded; the Worker is deployed.

#### Changed while building

- See *Decided while building* in Decisions, (a) to (f).

#### From review

Files: `reviews/pr-31-high.md` (10 findings), `reviews/pr-31-medium.md` (10),
`reviews/pr-31-check-medium.md` (9); all read in full.

- Applied: high 1, 2, 3, 4 (type half), 5, 6, 8; medium 1, 2, 3, 6, 10; check 4.
- Skipped #4, reopen half (`reviews/pr-31-high.md`): "a repeat call reopens a resolved item" - decision (b): the repeat ask must show on the board.
- Skipped #7 (`reviews/pr-31-high.md`): "Optional fields can only be set, never cleared" - the same gap was applied as medium 2 (decision (c)).
- Skipped #9 (`reviews/pr-31-high.md`): "Auth scheme match is case-sensitive" - low, not fixed in this slice.
- Skipped #10 (`reviews/pr-31-high.md`): "two D1 reads of the same row per done mark" - low, not fixed in this slice.
- Skipped #4 (`reviews/pr-31-medium.md`): "D1 binding has no database_id" - decision (a): wrangler resolves the database by name and D1 names are unique per account.
- Skipped #5 (`reviews/pr-31-medium.md`): "duplicate find in markDone/askHuman then reportProgress" - low, not fixed in this slice.
- Skipped #7 (`reviews/pr-31-medium.md`): "Bearer prefix match case-sensitive" - low, not fixed in this slice.
- Skipped #8 (`reviews/pr-31-medium.md`): "method check runs before auth" - low, not fixed in this slice.
- Skipped #9 (`reviews/pr-31-medium.md`): "built per request and never closed" - low, not fixed in this slice.
- Skipped #1 (`reviews/pr-31-check-medium.md`): "an extra find per write costs 1-2 D1 reads" - low, not fixed in this slice.
- Skipped #2 (`reviews/pr-31-check-medium.md`): "heartbeat note inferred from" - not fixed in this slice; see Follow-ups.
- Skipped #3 (`reviews/pr-31-check-medium.md`): "A request delayed in D1 commits last" - not fixed in this slice; see Follow-ups.
- Skipped #5 (`reviews/pr-31-check-medium.md`): "the event row takes status and source from the stored item" - low, not fixed in this slice; see Follow-ups.
- Skipped #6 (`reviews/pr-31-check-medium.md`): "heartbeat-only report writes an items update and an events row, with no coalescing or cap" - the Decisions give a heartbeat event per report; see Follow-ups.
- Skipped #7 (`reviews/pr-31-check-medium.md`): "get_item returns every event and list_open every item in the window" - the Decisions return all events on `get_item`; see Follow-ups.
- Skipped #8 (`reviews/pr-31-check-medium.md`): "A repeat ask_human on an item the owner marked done silently reopens it" - decision (b).
- Skipped #9 (`reviews/pr-31-check-medium.md`): "`givenParams` casts to `string | null`" - low, only a future caller is affected.

#### Follow-ups

- `src/infrastructure/d1Repository.ts:74`: the heartbeat note is inferred from `updated_at = ?1`; two writes in one millisecond can leave a blank note (check 2).
- `src/infrastructure/d1Repository.ts:64`: a request delayed in D1 can move `heartbeat_at` and `updated_at` backwards; use `MAX` or time in SQL (check 3).
- `src/infrastructure/d1Repository.ts:73`: the event row takes status and source from the stored item, not the report (check 5).
- `src/infrastructure/d1Repository.ts:92`: heartbeat events have no coalescing or cap, so `events` grows and costs rows written (check 6).
- `src/mcp/tools.ts:111`: `get_item` and `list_open` have no size limit or `truncated` marker (check 7).

#### For CLAUDE.md (lifted 2026-11-15)

None beyond the branch's own edits.

#### For README.md (lifted 2026-11-15)

None beyond the branch's own edits.

#### Not yet verified

- The Claude Code `claude mcp add --transport http` check against the deployed URL (the curl checks passed, see *Verified 2026-11-15*).
- That the Workers Builds build token can apply D1 migrations (`npm run deploy:ci`). Seen 2026-11-15: the tables exist after the pipeline deploy. Not seen: the pipeline log.
- That `wrangler deploy` binds the existing database by name (no `database_id`). Seen 2026-11-15: the Worker reads and writes D1 after the pipeline deploy. Not seen: `wrangler.json` was not inspected.

*Verified 2026-11-15* (Worker at c1cc5de, checks run by curl from the host; raw output not kept in the repo):
the whole "Against the deployed Worker" list of Verification. `report_progress` created `a` (in_progress);
the same key again gave blocked with `created_at` unchanged and one item in `list_open`; `mark_done` closed `b`
(via `ask_human`) with `done_at`; `list_open` returned open `a` and done `b`; after 3 s a `window_hours` of
0.0005 returned only `a`. No token gave 401; the read token calling `report_progress` got the error
"forbidden: this token is read-only, a write token is required" and `get_item` for that key found no item
(nothing written). The plain-POST curl half of the Claude Code and curl line passed too.
