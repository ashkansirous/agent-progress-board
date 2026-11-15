# agent-progress-board

A phone-friendly board of work progress across projects, fed by coding agents.

One group per project. Each item (a planned slice, a problem, something waiting for a person,
a bug, new unplanned work) is a colour-coded tile with one line of what and why, plus its
parent. The board shows everything still open plus whatever finished in the last 12 hours.
Everything is exposed through one remote MCP server: agents load it as an MCP server, or post
the same MCP tool calls over HTTPS where they can't. Clients live in the repos that use them.

Status: building (Slice 1, the MCP items API). See [plan.md](plan.md).

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

Tests run in the Workers pool against a local D1. `wrangler dev` reads `.dev.vars` (copy
`.dev.vars.example`). Deploys happen only through Cloudflare Workers Builds on merge to
`main`, whose deploy command is `npm run deploy:ci` (D1 remote migrations, then deploy).

Secrets (Worker secrets, never in the repo): `BOARD_WRITE_TOKEN` (all tools) and
`BOARD_READ_TOKEN` (`list_open`, `get_item`). Optional var `BOARD_CONFIG`: one JSON string,
see `config/board.example.json` (window hours, projects, type labels and colours).

## MCP tool reference

One endpoint: `POST /mcp` (Streamable HTTP, stateless, JSON responses) with
`Authorization: Bearer <token>`. A missing or wrong token gets 401. A read token calling a
write tool gets a tool error and nothing is written. Invalid input returns a tool error
naming the field; nothing is written.

Enums: `type` = `slice | problem | waiting_for_me | bug | unplanned`; `status` =
`open | in_progress | blocked | done | stale`; `priority` = `P0 | P1 | P2 | P3` (default `P2`).
Keys are stable and chosen by the reporter, for example `<project>/slice-58`.

| Tool | Scope | Inputs | Returns |
| --- | --- | --- | --- |
| `report_progress` | write | `key`; for a new key also `project`, `type`, `title`; optional `status`, `priority`, `parent` (text), `why`, `details_md`, `links` (`[{label,url}]`), `source`, `note` | the item |
| `mark_done` | write | `key`, optional `source`, `note` | the item |
| `ask_human` | write | `key`, `project`, `title`; optional `parent`, `priority`, `why`, `details_md`, `links`, `source`, `note` (creates or updates a `waiting_for_me` item, open) | the item |
| `list_open` | read | optional `project`, `type`, `window_hours` (capped by config) | items not done, plus items done inside the window, each with its latest 20 events |
| `get_item` | read | `key` | the item with all its events, newest first |
| `sync_snapshot` | write | `project`, `items[]` (each `key`, `project`, `type`, `title`, `status`; optional `priority`, `parent`, `why`, `links`; at most 200) | `{project, created, updated, closed, unchanged}`; doc-sync items missing from the list become done |

Optional fields on `report_progress` and `ask_human`: leave one out to keep the stored value, send
`null` to clear `parent`, `why`, `details_md`, `links` or `source`. An empty string for `note`,
`why`, `details_md` or `parent` is a tool error naming the field.

An item has `key`, `project`, `parent`, `type`, `priority`, `status`, `title`, `why`,
`details_md`, `links`, `source`, `heartbeat_at`, `created_at`, `updated_at`, `done_at`. A
report that changes nothing but the heartbeat writes an event with the note `Heartbeat`.

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
