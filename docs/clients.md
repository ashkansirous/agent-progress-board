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

### Adding the board to claude.ai (OAuth)

claude.ai cannot send a bearer header; it signs in with OAuth. In claude.ai open Settings,
Connectors, add a custom connector, and give it `https://<your-worker-host>/mcp`. claude.ai
discovers the sign-in from the 401 on `/mcp`, opens the board's page, and you enter the owner
passphrase (the Worker secret `OWNER_PASSPHRASE`) and press Allow. When the Worker has
`public_origin` set, every client, bearer tokens included, must use that origin; other
hostnames of the Worker answer 401. The connector is
**read-only**: `list_open` and `get_item` work, every write tool answers
`forbidden: this token is read-only`. Reporters keep using the write token. A wrong
passphrase shows the page again; nothing locks.

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
- **HTTP errors:** `401 Unauthorized` (with `WWW-Authenticate: Bearer resource_metadata="..."`)
  for a missing or wrong token; `405 Method not allowed` (with `Allow: POST`) for anything but POST; `404` for any
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

**Staleness.** A cron job on the board runs every 15 minutes. An `in_progress` or `blocked`
item that a report (not doc sync alone) set, and whose last report is older than the expiry
(`staleAfterMinutes` in `BOARD_CONFIG`, default 120, from 60 to 10080), turns `stale` with the history note
`Heartbeat expired`. So a client must call `report_progress` at least once per expiry while it
works. Any report on a stale key brings it back: with a `status` that status is set, with only
the `key` the item returns to the live status it had before it expired. Items only the docs
set never go stale.

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

### `sync_snapshot` (write token)

Send one project's full set of items as its plan documents describe them. A client that parses
a repo's plan documents calls this once per project, after each parse. It is atomic (one batch:
a failure leaves nothing half applied, so retry the whole call) and idempotent.

Inputs:

- `project` (required): the project this set belongs to.
- `items` (required): the project's full doc-sync set, at most 200 items (the error names the
  limit). An empty list is valid. Each item:
  - `key`, `project`, `type`, `title`, `status`: required. `project` must equal the call's
    `project`, and a key may appear only once in the call.
  - `priority`, `parent` (display text, for example `Plan · Search`), `why`, `links`: optional.
    The limits and the allowed values are the ones in *The item*.

Output (a counts summary, not items): `{project, created, updated, closed, unchanged}`.
`created` counts keys the board had not seen, `updated` counts existing items the sync
changed, `closed` counts items that left the snapshot, `unchanged` counts snapshot items that
needed no write.

Errors (tool errors, nothing written): a read token (`forbidden: this token is read-only, a
write token is required`); more than 200 items; an item whose `project` differs from the
call's (`field items: <key> has project <p>, the call is for <project>`); a repeated key; a key
that is already stored under another project; any invalid value.

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
      "name": "sync_snapshot",
      "arguments": {
        "project": "demo-app",
        "items": [
          {
            "key": "demo-app/slice-58",
            "project": "demo-app",
            "type": "slice",
            "title": "Add the export button",
            "status": "open",
            "parent": "Plan · Export",
            "why": "Users asked for CSV export",
            "links": [{"label": "Slice file", "url": "https://example.com/docs/slice-58"}]
          }
        ]
      }
    }
  }' || true
```

Reply text (parse it as for the other tools): `{"project":"demo-app","created":1,"updated":0,"closed":0,"unchanged":0}`.

**The merge rule**, per key:

- The docs own `title`, `why`, `parent` and `links`: the snapshot's values always win. A field
  the snapshot leaves out is cleared (`why` and `parent` become null, `links` empty).
- `type` and `priority` are used only when the key is new (priority defaults to `P2`); the docs
  never change them afterwards.
- The status shown is the live one (from `report_progress`, `mark_done` or `ask_human`) when a
  live report came after the docs last changed their status; otherwise the docs' status wins.
  So a live `in_progress` survives every sync until the docs change that item's status, and a
  docs change made after the last live report wins. Sending the same docs status again is not
  a change.
- First sight of a key the board already holds from a live report: the live status stays until
  the docs change. With no live report, the docs' status shows. One exception: a first-sight
  docs status of `done` always wins, because docs record a finish only after it happened.
- A key missing from the snapshot becomes `done` (event note "Left the plan") if the sync had
  it in the project's last snapshot. Items only ever reported live are never touched by a
  snapshot. An empty list closes every doc-sync item of the project. If a closed key returns in
  a later snapshot, it carries a new docs status and reopens.
- The same snapshot twice changes nothing: no write, no event, `updated_at` untouched.
- A sync records an event (source `doc-sync`) only when the shown status changes, and takes over
  the item's `source` only then.
- If a live report lands between the sync's read and its write, that item keeps the live
  status and the next sync settles it.

## Keys

A key is chosen by the reporter and must be the same every time the same thing is reported:

- `<project>/slice-<N>`: a planned slice, for example `demo-app/slice-58`
- `<project>/slice-<N>/check-<hash>`: one verification check of a slice (`<hash>` is whatever stable hash
  the client derives from the check's text)
- `<project>/session-<id>`: one coding-agent session

Document sync (`sync_snapshot`, above) uses the same keys for slices read from plan documents,
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
- **A session still running:** a `report_progress` with just the `key` as a heartbeat, at
  least once per expiry (default 2 hours; every 30 minutes is safe), or the item turns stale.

## Cloud sessions

For Claude Code cloud sessions (Claude Code on the web). The setup belongs to the client repo
and the owner's environment; this page only says what the board needs and what the Claude Code
docs promise (read 2026-11-15; the docs change, so re-read them before relying on a detail):
[cloud environments](https://code.claude.com/docs/en/cloud-environments),
[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web),
[settings in cloud sessions](https://code.claude.com/docs/en/settings#settings-in-cloud-sessions).

- **Network: allow the board host.** A new environment starts at the *Limited* level, which
  allows the default package registries, GitHub and cloud SDKs only. Pick *Limited* and list
  the board host (for example `board.example.com`) in the environment's **Allowed domains**
  field, one domain per line (`*.` matches every subdomain). The list is per environment; there
  is no organisation-wide list. Without it every report fails the network call, and a
  fail-open client silently reports nothing.
- **MCP: both call styles work.** A `.mcp.json` committed in the repo loads in a session with
  one repository, so the `agent-board` entry from *Two ways to call* works as is. Servers added
  with `claude mcp add` at user or local scope are not loaded, because they live in
  `~/.claude.json` on the owner's machine, not in the repo. A client that does not want a
  committed `.mcp.json` uses the plain HTTPS POST instead, which needs nothing from the
  session but the network allowance above.
- **Where the URL and token go.** `AGENT_BOARD_URL` is not secret: set it as an environment
  variable (`KEY=value` lines in the environment dialog). `AGENT_BOARD_TOKEN` is a secret, so
  never put it in the repo (`.mcp.json` included), a prompt or a setup script. The docs
  describe two stores. Plain environment variables are not secret: anyone who can use the
  environment can read them, so a token there is exposed to everyone with access to that
  environment. Network secrets are the separate store: the value cannot be viewed again after
  saving, and the docs say the key does not appear in the session's environment variables or
  in any file. Organisations with customer-managed keys cannot save network secrets, and the
  docs do not say how they are stored at rest. Use the least-exposed store you can: keep the
  token in a network secret where available, and otherwise accept that the environment's users
  can read it and use a dedicated write token you can rotate.
- **Open point for the client author.** The docs read for this page do not say how a network
  secret reaches an outgoing request (whether it is injected for the hosts it is bound to, and
  in which header). Because it is not in the session's environment, `${AGENT_BOARD_TOKEN}` in
  `.mcp.json` or `$AGENT_BOARD_TOKEN` in a script cannot see it. Check the current
  *Add network secrets* section of the cloud-environments page before building on it, and
  test one report from a real cloud session. Until then, the only documented way for the
  client to read the token is as a plain environment variable, with the exposure above.
- **Hooks.** `SessionStart` hooks behave the same in the cloud as locally. Hooks from the
  repo's `.claude/settings.json` run in a cloud session; hooks in the owner's user-level
  `~/.claude/settings.json` do not. A reporting hook for cloud sessions therefore goes in the
  repo's settings. The environment also has a setup script that runs before Claude launches;
  the docs do not say whether a file in the repo is read as that script.

A client still fails open here: with the host not allowed, the token missing or the secret not
reachable, it does nothing and exits 0.
