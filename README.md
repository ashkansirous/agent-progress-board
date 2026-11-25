# agent-progress-board

A phone-friendly board of work progress across projects, fed by coding agents.

One group per project. Each item (a planned slice, a problem, something waiting for a person,
a bug, new unplanned work) is a colour-coded tile with one line of what and why, plus its
parent. The board shows everything still open plus whatever finished in the last 12 hours.
Everything is exposed through one remote MCP server: agents load it as an MCP server, or post
the same MCP tool calls over HTTPS where they can't. Clients for Claude Code live in `plugin/`
(a Claude Code plugin marketplace with one plugin, `agent-board`); other clients follow
[docs/clients.md](docs/clients.md).

Status: working, built slice by slice. See [plan.md](plan.md).

## Use it

You already have a board and want your Claude Code to report to it. Give your Claude Code this
one sentence:

> Install and set up the agent board plugin from https://github.com/ashkansirous/agent-progress-board, following docs/setup/connect.md

It installs the plugin, asks you for the board's address and write token, and proves the
connection with a test card. See [docs/setup/connect.md](docs/setup/connect.md). To run a board of
your own on your own Cloudflare account, give your Claude Code
[docs/setup/own-board.md](docs/setup/own-board.md).

## Design in one paragraph

A Cloudflare Worker with a D1 database holds the items. State comes from two sources merged
on one stable key per item: a sync step that reads each repo's plan documents, and live
events pushed by agents and hooks. Item types, colours and the project list come from
configuration; the code holds no project data.

## Develop

```
npm ci
npm run lint && npm run typecheck && npm test
```

Tests run in the Workers pool against a local D1. `npm run dev` (Vite with the Worker) reads
`.dev.vars` (copy `.dev.vars.example`); raw `wrangler dev` has no built assets and is not used. Deploys happen only through Cloudflare Workers Builds on merge to
`main`, whose deploy command is `npm run deploy:ci` (D1 remote migrations, then deploy).

## The board page

A React + TypeScript page (`web/`, built by Vite) served by the Worker as static assets: a
count row by the title, and one block per project that folds (Needs you, Working now, Planned,
Problems and bugs, Done; a quiet project and Done start folded, a project with a question opens on
load, the choice is kept in the browser), a detail panel
(side panel on desktop, bottom sheet on the phone), light and dark colours from the board
config, fonts bundled with the page. It reads `GET /api/board`, which answers with the open
items, those done in the window, their details, links and latest events, and the config the
page draws with (colours and labels from `BOARD_CONFIG`, filled from `config/board.example.json`).

An **Active work** view (`#/active`, a tab beside Board and Usage with a count) lists every task an
agent is working on now: its step in words, `N of M steps · P%` over one bar segment per step, and
the full list on a toggle. A task's tile and drawer on the board show the same bar when it has steps. A slice made of lettered parts (A, B, C) shows a bar of parts done
over parts, the part being worked on now, and a link that opens that part's card on Active work.

Checks ("not tried on a device" lines) live inside their slice, never as cards; problems and bugs have their own list.

The page and `/api/board` are closed until Cloudflare Access is set up: the Worker refuses
every request that has no valid Access JWT, and refuses all of them while the Worker secrets
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are unset. `/mcp` keeps its bearer tokens.

```
npm run build      # vite build: page to web/dist/client, Worker bundle beside it
npm run test:e2e   # Playwright (chromium) at 1440x900 and 390x844, /api/board faked
npx playwright install chromium   # once
npm run seed       # BOARD_URL=<worker>/mcp BOARD_WRITE_TOKEN=<token>; --dry-run prints the calls
```

`npm run dev` runs the Worker behind the same gate, so the real page can be opened only through
Cloudflare Access (there is no local bypass). The E2E tests serve the bare page with
`vite --mode e2e` (no Worker, no gate); that mode refuses to start or build unless
`playwright.config.ts` sets its env flag.

Worker secrets (never in the repo; `wrangler secret put <NAME>`): `BOARD_WRITE_TOKEN` (all
tools), `BOARD_READ_TOKEN` (`list_open`, `get_item`), `OWNER_PASSPHRASE` (the claude.ai sign-in
page, see *OAuth for claude.ai*), `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and the
optional `BOARD_CONFIG` (one JSON string, see `config/board.example.json`: window hours, `staleAfterMinutes`,
projects, type labels and colours). The last three are secrets too because the pipeline deploy
(`wrangler deploy`) replaces dashboard plain-text vars with the config file's and the file holds
none, while it keeps secrets. In `BOARD_CONFIG` a type's old single `color` key is no longer read:
use its `light` and `dark` colour sets.

## OAuth for claude.ai

claude.ai connects from Anthropic's cloud and signs in with OAuth, so `/mcp` also accepts OAuth
tokens next to the bearer tokens (`@cloudflare/workers-oauth-provider`, storage in the KV
binding `OAUTH_KV`). To add the board: in claude.ai open Settings, Connectors, add a custom
connector with the URL `https://<your-worker-host>/mcp`; claude.ai opens the board's sign-in
page, you type the owner passphrase and allow. An OAuth caller is the owner's own and can
read and report (`report_progress`, `ask_human`, `mark_done`, `report_usage`, `report_cap`);
`sync_snapshot` needs the bearer write token (Slice 16).

- Endpoints: `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`,
  `/oauth/register` (open registration, limited to Claude's redirect addresses), `/authorize`,
  `/oauth/token`.
- The owner check is the Worker secret `OWNER_PASSPHRASE`, compared in constant time; unset or
  shorter than 32 characters, the page refuses everyone. Nothing counts or locks wrong tries: the
  long passphrase is what makes guessing hopeless. Approval always grants read and write (the owner's tools, no document sync); the page shows
  the client's name and the full address (with port) the access is sent to.
- Extra redirect addresses (exact strings) go in `BOARD_CONFIG` as `oauth_redirect_uris`.
- The issuer and resource default to the origin of the request. To pin them (so the
  workers.dev name and a custom domain do not issue tokens that fail on each other), set
  `public_origin` in `BOARD_CONFIG` to an https origin, for example
  `{"public_origin": "https://board.example.org"}`. Once it is set, every client, bearer
  tokens included, must use that origin: the other hostnames of the Worker (for example the
  workers.dev name) answer 401.
- Changing `OWNER_PASSPHRASE` only guards new sign-ins; access already granted keeps working
  until the grant's refresh token expires. To end it now, open the Setup page (`#/setup`) and press
  **End access** on the app under "Connected apps". Behind the same Cloudflare Access check as the page,
  `GET /api/grants` lists the owner's grants (name and time) and `POST /api/grants/<id>/revoke` ends one
  (`env.OAUTH_PROVIDER.listUserGrants` and `revokeGrant`); the app then has to be connected again. A
  grant stores the scopes `mcp:read` and `mcp:write`: the owner's token can write.
- Setup: the KV namespace is created by the pipeline deploy (the binding has no id in
  `wrangler.jsonc`); set the passphrase with `wrangler secret put OWNER_PASSPHRASE`.
- Locally: `OWNER_PASSPHRASE` in `.dev.vars` (see `.dev.vars.example`).

## MCP tool reference

Writing a client (hook, script, skill)? See the [client guide](docs/clients.md).

One endpoint: `POST /mcp` (Streamable HTTP, stateless, JSON responses) with
`Authorization: Bearer <token>` (a static token, or an OAuth token from the flow above). A
missing or wrong token gets 401 with a `WWW-Authenticate` header pointing at the resource
metadata. A read token calling a
write tool gets a tool error and nothing is written. Invalid input returns a tool error
naming the field; nothing is written.

Enums: `type` = `slice | problem | waiting_for_me | bug | unplanned`; `status` =
`open | in_progress | blocked | done | stale`; `priority` = `P0 | P1 | P2 | P3` (default `P2`).
Keys are stable and chosen by the reporter, for example `<project>/slice-58`.

| Tool | Scope | Inputs | Returns |
| --- | --- | --- | --- |
| `report_progress` | write | `key`; for a new key also `project`, `type`, `title`; optional `status`, `priority`, `parent` (text), `why`, `details_md`, `links` (`[{label,url}]`), `source`, `environment`, `steps` (`[{label, state, note?}]`, the whole list each time), `parent_key` (a part names its slice), `agent`, `model`, `needs_you` (the agent's question, up to 2000 characters), `after_answer` (up to 500), `note` | the item |
| `mark_done` | write | `key`, optional `source`, `note` | the item |
| `ask_human` | write | `key`, `project`, `title`; optional `parent`, `priority`, `why`, `details_md`, `links`, `source`, `note`, `after_answer` (creates or updates a `waiting_for_me` item, open; on a key of another type it sets `needs_you` on that item instead) | the item |
| `list_open` | read | optional `project`, `type`, `window_hours` (capped by config) | items not done, plus items done inside the window, each with its latest 20 events |
| `get_item` | read | `key`, optional `include_archived` | the item with all its events, newest first; an archived item reads only with `include_archived: true` |
| `report_usage` | write | `agent_key`, `model`, `record_at`, the four running token totals (`input_tokens`, `cache_write_tokens`, `cache_read_tokens`, `output_tokens`); optional `task_key`, `agent_kind`, `step`, `environment` | `{stored}`; the same report twice stores one sample |
| `report_cap` | write | `taken_at`, `plan`, `windows[]` (`kind`, `percent`, optional `reset_at`), optional `source` | `{stored, windows}`; stale readings are worked out when read |
| `sync_snapshot` | write | `project`, `items[]` (each `key`, `project`, `type`, `title`, `status`; optional `priority`, `parent`, `why`, `links`, and on a slice `parts` (`[{letter, title, done}]`); at most 200) | `{project, created, updated, closed, unchanged}`; doc-sync items missing from the list become done |
| `upsert_item` | static write token | the fields of one `sync_snapshot` item | `{op, key, outcome, raced}`; adds or updates that item and its parts and checks, closes nothing else (Slice 50) |
| `archive_item` | write | `key` | `{key, outcome, archived}`; there is no delete: the item and everything under it leave the board, `list_open` and every count, are kept 30 days (readable with `get_item` and `include_archived`), then the cron removes them for good (Slice 50) |
| `apply_batch` | write (upsert and close need the static write token) | `project`, `operations[]` (`{op: "upsert", item}`, `{op: "close", key}` or `{op: "archive", key}`; at most 200 items a call, parts and checks counted) | `{project, results[], created, updated, unchanged, closed, archived, raced}`; one atomic batch, a bad operation refuses the call and names its key (Slice 50) |
| `list_synced` | read | `project`, optional `after_key`, `limit` | `[{key, status, hash}]` (plus `archived: true` on an archived one), one page of the project's doc-sync items; the plugin compares the hashes and sends only changes (Slice 50) |

Optional fields on `report_progress` and `ask_human`: leave one out to keep the stored value, send
`null` to clear `parent`, `why`, `details_md`, `links`, `source`, `environment`, `steps`, `agent` or `model`. An empty string for `note`,
`why`, `details_md` or `parent` is a tool error naming the field.

An item has `key`, `project`, `parent`, `type`, `priority`, `status`, `title`, `why`,
`details_md`, `links`, `source`, `heartbeat_at`, `created_at`, `updated_at`, `done_at`, `needs_you`, `after_answer`, `needs_you_at`. A
report that changes nothing but the heartbeat writes an event with the note `Heartbeat`.

Usage (Slice 8): `report_usage` and `report_cap` store running token totals and raw cap readings;
`GET /api/usage` (behind Access, like `/api/board`) works out use, windows and dropped readings
when read. The same cron thins samples older than `usage.keepDays` (default 30) to one an hour.
Slice 9 adds `cap_cost` to that route: a best fit of how many tokens of each model use 1% of the
cap, a multiplier per environment, the share of cap growth no report explains, and the cost of
each task and agent kind in percent of the cap. It needs regular cap readings with the plan
name and the `environment` on every usage report; it cannot see chat, Claude Design or machines
without the client (see [docs/clients.md](docs/clients.md)).

A Workers cron trigger (every 15 minutes, `triggers` in `wrangler.jsonc`) turns a live
`in_progress` or `blocked` item whose heartbeat is older than `staleAfterMinutes` (config,
default 120, 60 to 10080) to `stale` and writes the event `Heartbeat expired`; a new report on
the key brings it back. Items only doc sync set never go stale.

A plain HTTPS POST works without an MCP client or an `initialize` call (both `Accept`
types are required):

```
curl -s https://<your-worker-host>/mcp \
  -H "Authorization: Bearer $BOARD_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"report_progress",
       "arguments":{"key":"demo-app/slice-58","project":"demo-app","type":"slice",
       "title":"Tag search","parent":"Wave 3","status":"in_progress"}}}'
```

## License

MIT, see [LICENSE](LICENSE). Public but unsupported: issues may not get answers.
