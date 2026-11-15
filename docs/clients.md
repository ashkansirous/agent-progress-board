# Client guide

For anyone writing a client that reports work to the board: a Claude Code hook, a script, a
skill, a cloud session. The board is one remote MCP server. Everything below is read from the
server code, so a client can be built from this page alone. Clients live in the repos that use
them; nothing client-side belongs in this repo.

All project names, keys and hosts in the examples are made up.

## Rules for every client

- **Fail open.** A client must never block or fail the caller: a timeout of a few seconds
  (3 s is a good default), swallow every error, exit 0. If `AGENT_BOARD_URL` or
  `AGENT_BOARD_TOKEN` is missing, do nothing and exit 0.
- **Env variables.** `AGENT_BOARD_URL` is the base URL of the board (for example
  `https://board.example.com`, no trailing slash, no `/mcp`); the client adds `/mcp`.
  `AGENT_BOARD_TOKEN` is a bearer token. Never write a token into a repo.
- **Two tokens.** The server holds two secrets. A write token (`BOARD_WRITE_TOKEN`) may call
  every tool. A read token (`BOARD_READ_TOKEN`) may call only `list_open` and `get_item`. A
  reporter needs the write token.
- **Idempotent.** Every write is an upsert on a stable `key`, so retrying or reporting twice
  is safe.

## Two ways to call

Same endpoint (`POST {AGENT_BOARD_URL}/mcp`), same tools.

### 1. As an MCP server (interactive Claude Code, claude.ai)

Streamable HTTP, bearer header. A `.mcp.json` entry (Claude Code expands `${VAR}` in `url` and
`headers`; use variable names of your own, not a name Claude Code treats as a credential):

```json
{
  "mcpServers": {
    "agent-board": {
      "type": "http",
      "url": "${AGENT_BOARD_URL}/mcp",
      "headers": { "Authorization": "Bearer ${AGENT_BOARD_TOKEN}" }
    }
  }
}
```

Or from the command line:

```
claude mcp add --transport http agent-board https://board.example.com/mcp \
  --header "Authorization: Bearer <token>"
```

### 2. A plain HTTPS POST (hooks, scripts, sessions that do not load MCP servers)

The server is stateless: no `initialize`, no session id. Send one JSON-RPC `tools/call` per
request. Both `Content-Type: application/json` and an `Accept` header naming both
`application/json` and `text/event-stream` are required (the transport rejects the request
otherwise); the reply is plain JSON.

```
curl -sS --max-time 3 -X POST "$AGENT_BOARD_URL/mcp" \
  -H "Authorization: Bearer $AGENT_BOARD_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "report_progress",
      "arguments": {
        "key": "demo-app/slice-58",
        "project": "demo-app",
        "type": "slice",
        "title": "Add the export button",
        "status": "in_progress",
        "why": "Users asked for CSV export",
        "source": "agent",
        "note": "Slice claimed"
      }
    }
  }' || true
```

Reply (HTTP 200):

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"key\":\"demo-app/slice-58\", ...}"}]}}
```

`result.content[0].text` is the tool's output serialized as a JSON string; parse it. A client
wrapper around the curl above should end with `|| true` and `exit 0`.

## Responses and errors

- **Success:** `result.content[0].text` holds the JSON output; `result.isError` is absent.
- **Tool error:** HTTP 200 with `result.isError: true` and `result.content[0].text` holding a
  plain message, for example `field key: no item demo-app/none`, `field title: required when
  creating item demo-app/slice-9`, `forbidden: this token is read-only, a write token is
  required`, or `internal error: the board could not complete the request`. Input that fails
  validation (wrong enum value, empty string, a link that is not http or https, too long) is
  also a tool error, and nothing is written.
- **HTTP errors:** `401 Unauthorized` (with `WWW-Authenticate: Bearer`) for a missing or wrong
  token; `405 Method not allowed` (with `Allow: POST`) for anything but POST; `404` for any
  path other than `/mcp`. A client treats all of them, and every network failure, as "report
  skipped".

## The item

Output of the write tools, and each element of `list_open`:

`key`, `project`, `parent` (text or null), `type`, `priority`, `status`, `title`, `why` (or
null), `details_md` (or null), `links` (array of `{label, url}`), `source` (or null),
`heartbeat_at`, `created_at`, `updated_at`, `done_at` (or null). Timestamps are ISO 8601
strings.

An event is `{at, status, source, note}`.

**Allowed values**

- `type`: `slice`, `problem`, `waiting_for_me`, `bug`, `unplanned`
- `status`: `open`, `in_progress`, `blocked`, `done`, `stale`
- `priority`: `P0`, `P1`, `P2`, `P3` (a new item defaults to `P2`)

**Limits.** `key` 1-200 characters; `project`, `title`, `parent`, `source` and link `label`
1-300; `why`, `details_md`, `note` and link `url` up to 20 000 (`why`, `details_md` and `note`
at least 1); `links` up to 20, each url a valid `http` or `https` URL.

## Tools

On the optional fields below: leave a field out to keep the stored value. Where "null clears"
is noted, sending `null` removes the stored value. An empty string is a tool error.

### `report_progress` (write token)

Create or update one item by `key`. For a **new** key, `project`, `type` and `title` are
required; for an existing key they are optional.

| Field | Required | Notes |
| --- | --- | --- |
| `key` | yes | stable key, see *Keys* |
| `project` | new key only | text |
| `type` | new key only | enum above |
| `title` | new key only | text |
| `status` | no | enum above |
| `priority` | no | enum above |
| `parent` | no | free text shown on the tile, for example `Wave 3`; null clears |
| `why` | no | one line of why; null clears |
| `details_md` | no | markdown; null clears |
| `links` | no | `[{label, url}]`, up to 20; null clears |
| `source` | no | who reported: `hook`, `agent`, `human`; null clears |
| `note` | no | history note for this report |

Returns the item. A report that changes nothing but the heartbeat writes an event with the note
`Heartbeat`, so a client can call it periodically to show a session is alive.

### `mark_done` (write token)

Sets an existing item to `done`. Fields: `key` (required), `source` (null clears), `note`.
Returns the item. An unknown key is the tool error `field key: no item <key>`.

### `ask_human` (write token)

Creates or updates a `waiting_for_me` item (status `open`): a step only the person can do.
Fields: `key`, `project`, `title` (all required), optional `parent`, `priority`, `why`,
`details_md`, `links`, `source`, `note` (same rules as `report_progress`). Returns the item. If
the key already exists as another type, the tool error is
`field key: <key> is a <type> item, not waiting_for_me`.

To clear a question, call `mark_done` with the same key.

### `list_open` (read or write token)

The board window: every item that is not done, plus items done inside the window.

Optional fields: `project`, `type` (enum above), `window_hours` (a positive number; the server
caps it at its configured maximum, default window 12 hours). Returns an array of items, each
with `events`: its latest 20 events, newest first.

### `get_item` (read or write token)

Field: `key` (required). Returns the item with `events`: its full history, newest first. An
unknown key is the tool error `field key: no item <key>`.

## Keys

A key is chosen by the reporter and must be the same every time the same thing is reported:

- `<project>/slice-<N>`: a planned slice, for example `demo-app/slice-58`
- `<project>/slice-<N>/check-<hash>`: one verification check of a slice (`<hash>` is whatever stable hash
  the client derives from the check's text)
- `<project>/session-<id>`: one coding-agent session

Document sync (planned, Slice 4) will use the same keys for slices read from plan documents,
so a live report and a slice read from a document are one tile. Use `project` equal to the
`<project>` part of the key.

## What to report and when

Guidance, not code: each client repo decides what it implements.

- **Slice claimed:** `report_progress`, type `slice`, status `in_progress`, source `agent`.
- **Slice in review:** same key, `status: in_progress`, a `note` such as "In review", or a link
  to the PR in `links`.
- **Slice merged:** `mark_done`.
- **Slice parked or blocked:** `report_progress` with `status: blocked` and a `why`.
- **A session needs a person:** `ask_human` on the session's or slice's key with a one-line
  `title` and the reason in `why`; `mark_done` once answered.
- **A session finished:** `mark_done` on `<project>/session-<id>`.
- **A session still running:** an occasional `report_progress` with just the `key` as a
  heartbeat.
