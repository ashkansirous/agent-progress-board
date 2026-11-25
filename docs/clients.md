# Client guide

For anyone writing a client that reports work to the board: a Claude Code hook, a script, a
skill, a cloud session. The board is one remote MCP server. Everything below is read from the
server code, so a client can be built from this page alone. The Claude Code client is the plugin in
`plugin/`; any other client lives in the repo that uses it.

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

## Setup for an AI agent

An AI that should report its own work needs only the connector:

- **Claude Code:** install the plugin in `plugin/` (the MCP server plus a skill with these rules):
  follow [docs/setup/connect.md](setup/connect.md). Only a Claude Code that cannot use plugins adds the MCP
  server entry by hand (see *As an MCP server* below).
- **claude.ai:** add the custom connector and sign in with OAuth (see *Adding the board to claude.ai*).

The server sends its own instructions in the `initialize` result (`src/mcp/instructions.ts`). They
carry the reporting rules: open a card when a task with an outcome starts (never for a plain chat or an orchestrator), with `outcome` set, keep its steps current,
report at least every 5 minutes while working (a client with no clock: at every step change and before and after a long wait, never on every tool call), keep a step active while a background agent works, `mark_done` only
when the goal is done, questions in `needs_you`. Where the client shows server instructions to the
model, no pasted text is needed. The pasted chat instruction under *Making every chat report* is
needed only where the client ignores server instructions. The plain HTTPS POST path (*Two ways to
call*, option 2) and hooks never call `initialize`, so they receive no instructions: that prompt or
script must carry the rules itself.

### What the plugin's hooks do on their own (Slice 21)

The plugin also installs hooks (`plugin/hooks/hooks.json`, scripts in `plugin/scripts/`, Node, no dependencies).
Every script fails open: a missing address or token, a timeout (2 s) or a board error is one stderr line and exit 0.
Config comes from the plugin options (`CLAUDE_PLUGIN_OPTION_BOARD_URL`, `CLAUDE_PLUGIN_OPTION_BOARD_TOKEN`), else the
environment (`AGENT_BOARD_URL`, `AGENT_BOARD_TOKEN`); there is no built-in address. Small per-session files go in
`CLAUDE_PLUGIN_DATA/state`, never the plugin folder. The project name is the main checkout's folder name unless
`AGENT_BOARD_PROJECT` is set.

| Hook event | What it does |
| --- | --- |
| `PostToolUse` | Local files only. Remembers the key of the session's own card: a main-thread `report_progress` call with agent `session` (later calls on the same key, and `mark_done`, update it). At the second tool call of a prompt with no goal reported, it reminds the session once per prompt: "If this prompt started a task with an outcome, report it on the board". A session marked with `report-progress --orchestrator` (a wave runner; its slices have their own cards) gets no reminder and no card update from the hooks (Slice 41). |
| `UserPromptSubmit` | Reopens a card the Stop hook closed ("Session resumed"), marks this session's waiting item done, and closes dead waiting items (below). Starts the reminder's prompt counter. |
| `Stop` | Marks the session's card done ("Session stopped"). If a background agent's record (`<session>/subagents/*.jsonl`) changed in the last 10 minutes, the card stays `in_progress` with the note "background agents running" instead. While the session has an open `needs_you` question the card is not closed, and every hook report repeats the question text (a done or stale-to-in-progress report would clear it). Also marks the session's waiting item done. |
| `SubagentStop` | Sends the card's steps again with the stopped agent done, when the list changed. Also marks the session's waiting item done. |
| `Notification` (`permission_prompt`, `elicitation_dialog`, `idle_prompt`) | Raises a `waiting_for_me` item `<project>/waiting-<session id>` (`report_progress`), never the session card's key, and only when something is asked: a permission prompt or an elicitation always, an idle prompt only when the session's last message (read from the transcript tail) ends with a question. `needs_you` is the question (at most 300 characters; a permission prompt names the tool and its command), `after_answer` what follows when the message says it, the title the session's goal (else the project and branch). An idle prompt after a status line opens no card. |

- **Agent steps.** Each background agent whose record changed in the last 10 minutes is a step, labelled with its
  `description` from `subagents/*.meta.json`, after the steps the session sent; it is `done` once it stopped. The board
  allows any number of active steps (Slice 39), so every running agent is `active` and the session's own active step
  stays as it is.
- **A dead session's waiting item.** A waiting item whose session sent nothing (no prompt, tool call or hook) for 30
  minutes is closed "Session ended" by the next hook of any session on the same machine.
- **The CLI.** `plugin/scripts/report-progress.mjs` sends one report from a script (`--key` or `--slice`, `--title`,
  `--steps "a|b|c"` or `--steps-file <path>`, `--step-active`, `--step-done`, `--tool mark_done`); its header lists every
  flag. A steps file is JSON: `{ "agent": "..", "steps": [{ "label": "..", "note": "..", "needsTouch": [".."] }] }`.

### Token usage and cap readings from the plugin (Slice 22)

`plugin/scripts/usage-tick.mjs` is wired to `PostToolUse` (through a five-minute gate: it reads one small file and
returns at once) and to `Stop` and `SubagentStop` (`--force`, past the gate). A due run starts itself again in the
background, takes a lock and then sends, in one pass: one `report_usage` per agent and model (running totals, read
from Claude Code's own session records in `~/.claude/projects`, or the folder in `AGENT_BOARD_CLAUDE_DIR`, else Claude Code's own `CLAUDE_CONFIG_DIR`), a
heartbeat for each task a session reported with the CLI (`<state>/<session>.task.json`), and one `report_cap`. It
opens no card: session cards come from the session's own reports and the hooks above. The gate, lock, scan state and
cap state live in `CLAUDE_PLUGIN_DATA/state`; nothing is written to the Claude folder.

- **Options.** `report_usage` (boolean, default true) turns token reports and the cap reading off, and
  `AGENT_BOARD_USAGE=off` still does; with either, no usage or cap call is made; the task heartbeat still goes (it is
  not a token count or cap reading). `read_plan_cap` (boolean, default false) turns the cap reading on; it runs only
  while `report_usage` is on too. `environment` (string, optional, for example `desktop`) is the
  environment label on usage reports; `AGENT_BOARD_ENV` is the fallback.
- **The cap reading reads Claude Code's own sign-in file** (`.credentials.json` in the Claude folder) to ask Anthropic's
  usage address for the plan's cap percentage; the token stays in memory, goes to that address only, and is never
  sent to the board, stored or printed. It runs only when `read_plan_cap` is on; turning `report_usage` off stops it too.
- **A device check** sets `AGENT_BOARD_DEBUG=1` to see one stderr line per branch (gate closed, run started, usage
  off, cap sent or skipped).

### Plan sync (Slice 23, optional)

`plugin/scripts/sync-docs.mjs` reads a repo's `plan.md` `## Status` table, `docs/plan/slices/`, and
`docs/plan/unverified.md` from `origin/main`, reads what the board holds with `list_synced` and sends only the changes
with `apply_batch`, in calls of at most 200 items (Slice 50; fail open, idempotent;
usage and the layout it expects: `docs/setup/plan-sync.md`). A `parked:` row becomes a `waiting_for_me` card unless
its reason only waits on work (another slice, an interactive session, a deploy, a merge); an `unverified.md` line
starting `**You:**` becomes a `waiting_for_me` card: its title is `Slice <N>: <short action>` and its steps are the card's text (write the line `**You:** <short action> | <steps>`; a line with no bar is all action), `why` names the slice and what the step unblocks, and it links to the slice file (a `parked:` card's title is the slice file's "Open for the owner" lines). The plugin installs no hook for it; run it after a merge.

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
hostnames of the Worker answer 401. A caller signed in this way is the owner's own: it can
call `list_open`, `get_item`, `report_progress`, `ask_human`, `mark_done`, `report_usage` and
`report_cap`, whatever scope its grant stored (grants made before Slice 16 need no
reconnect). `sync_snapshot` stays with the static write token and answers
`forbidden: sync_snapshot needs the static write token`. Coding-agent reporters keep using the write
token. A wrong passphrase shows the page again; nothing locks.

#### Making every chat report (the owner adds this once)

claude.ai chats and Claude Design sessions cannot read their own token use or cap percentage
(the usage page is shown to the person only), so they report when work starts and ends; the board
then puts cap growth that no token report explains, inside that window, against the
environment the chat named (Slice 16). A chat can call the connector's tools (custom connectors
work in chat on every plan). Whether a Claude Design session can is unproven (the Design page
lists only built-in connectors), so the text below is for chat; try it in Design once and record
the answer.

Needed only where the client ignores the server's instructions (see *Setup for an AI agent*).
Where to paste it: claude.ai, Settings, "Your Claude", Instructions (older layout: Account,
"Instructions for Claude"): <https://claude.ai/settings>.

Get the text from the board page: open `<board address>/#/setup` (the "Set up a chat" link in
the board header, behind the same Access sign-in as the board), press **Copy**, and paste it.
The page reads the same `SERVER_INSTRUCTIONS` constant the server sends in `initialize`
(`GET /api/chat-text`), so there is one text and nothing to keep equal (Slice 19). Start your
pasted text with the connector line the panel shows apart, with its own **Copy the line**
button (the line comes from the Worker, `CHAT_PREFACE` in `src/api/chatText.ts`). Add the
environment to name, for example "Claude chat" or "Claude Design" (a chat or a coding session).

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
`heartbeat_at`, `created_at`, `updated_at`, `done_at` (or null), and `needs_you`, `after_answer`,
`needs_you_at` (the question, what follows, when first asked; each null when none). Timestamps are
ISO 8601 strings.

An event is `{at, status, source, note}`.

**Allowed values**

- `type`: `slice`, `problem`, `waiting_for_me`, `bug`, `unplanned`, `part` (one lettered part of a
  slice, see *Slice parts* below)
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
| `environment` | no | where the work ran, as the client names it (free text, 1 to 40 characters, for example `laptop` or `cloud-vm`); null clears |
| `steps` | no | the task's whole steps list, in order (see *Steps* below); null or an empty list clears |
| `parent_key` | no | the key of the item this one belongs to; a part names its slice (see *Slice parts* below); not its own key; null clears |
| `agent` | no | the kind of agent holding the task, free text (1 to 100 characters, for example `Implementer`); null clears |
| `model` | no | the agent's model, free text (1 to 100 characters); null clears |
| `note` | no | history note for this report |

Returns the item. A report that changes nothing but the heartbeat writes an event with the note
`Heartbeat`, so a client can call it periodically to show a session is alive.

#### Steps (Slice 10)

A task carries its own list of steps; the board has no built-in list and holds no step names.
Each step is `{id?, label, state, note?, children?}`: `label` 1 to 80 characters, `state` one of `done`,
`active` or `pending`, `note` 0 to 120 characters (shown under the label). Steps form a tree (Slice 39):
at most 200 steps in all, at most 4 levels, and any number may be `active` at once. Labels and notes are shown as sent.

- **Send the whole list each time.** The newest list wins and replaces the stored one; a report
  that leaves `steps` out keeps it. A step sent without `children` keeps the children stored under
  its id; `children: []` clears them. Progress counts leaves (steps with no children): leaves done over
  leaves (1 of 7 is 14%), worked out when the board is read; a task marked done shows 100% whatever its list says.
- **Ids and times.** A step's `id` (1 to 80 characters, unique in the tree) keeps it the same step across
  reports; left out, the board makes it from the label path (`Parent/Child`, `#2` on a repeat, cut to 80
  characters with a short hash). That form changes when a label or the order changes, so send a short stable
  `id` on every step that has children or that helpers report under, and tell the helper the id. The board
  stamps `started_at` (first active or done) and `done_at` (became done), UTC ISO, and keeps them by id.
- **`under_step`.** `report_progress` with `under_step: <step id>` takes `steps` as only that step's
  children (an empty list clears them); the rest of the list stays. An unknown id is refused with the ids
  that exist. A helper agent uses it to report its own steps under the step it works on.
- **Trim the list to the task.** Each kind of agent keeps its own usual list on the client side
  and a task sends only what it really needs: no phone test step when no phone code changed. A
  list may shrink or grow while the task runs (a step that is dropped simply is not sent again).
  A short `note` can say why a step is missing or what counts under it.
- **Helpers report their own steps as children.** A helper agent reports its steps with `under_step`
  set to the id of the step it works on (this replaces the Slice 10 rule that helpers add no steps).
  The page unfolds them in place under that step, and the steps of several helpers may run at once.
  Under the Claude Code plugin, a background agent's helper uses its own row id instead (next point).
- **Background agents are child rows (Slice 40).** The plugin's `SubagentStart` hook records the step that is
  running when the agent starts (by its `id` when the session gave one, else by its label: give an `id` to
  every step an agent may run under) and puts the agent in the list as its own row under that step, after the
  step's own children (the root when none was running). The row's `id` is `agent-<agent id>`, its label the
  agent's description (with none, `Helper agent: <first words of its prompt>`), its note `Helper agent · <model>`,
  and it is `active` while the agent works. The session's steps are sent as the session sent them; a step
  its agent still runs under is sent `active` even if the session marked it done. The card is not closed while an agent works.
  The hook returns the helper its card key and its row id as `additionalContext`, so the helper runs
  `node report-progress.mjs --key <card key> --steps "a|b|c" --under-step agent-<agent id>` (the reporter
  CLI's `--under-step`; other clients send `steps` with `under_step`) from its first step: the row exists by then.
  The hooks send the row without `children`, so the board keeps what the helper reported under it. Over 200
  steps (nested ones count) the oldest finished agents are dropped first.
  Other work (a long build) that is not a background agent keeps its step `active`, with a note, until it finishes.
- **Active work.** The Active work page lists a task while its status is `in_progress`, it has a
  steps list or an `agent`, and its last report is newer than the stale expiry (below), whether or
  not the cron has run yet. Send `agent`, `model` and `environment` with the steps.
- `get_item` and `list_open` return `steps` (each `{id, label, state, note, started_at, done_at, children}`), `agent`, `model` and
  `environment` on the item.

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

Creates or updates a `waiting_for_me` item (status `open`): a step only the person can do (a
console step, a device in hand).
Fields: `key`, `project`, `title` (all required), optional `parent`, `priority`, `why`,
`details_md`, `links`, `source`, `note` (same rules as `report_progress`), `needs_you` and
`after_answer`. On a `waiting_for_me` item, `needs_you` puts the question under *Needs you* and
`links` say where to act.
Returns the item. If the key already exists as **another type**, the item keeps its type, status
and title and gets a question instead: `needs_you` is set from the field of that name, else from
`why`, else from a question that is still open, else from the title; `after_answer` from the field
of that name (see *A session card* below). `needs_you: null` clears the question, and a `why` sent
beside a `needs_you` is stored as the item's `why`. A part, a done item and an item that comes from
the plan documents are refused.

`list_open` and `get_item` keep their reply under 50,000 characters (the size at which Claude Code
saves a result to a file); when something is left out or cut, the result has a second text block
starting `truncated:` that says what.

To clear a `waiting_for_me` item, call `mark_done` with the same key.

### A session card: goal, purpose, steps and a question (Slice 13)

A session writes a card when it takes on a task with an outcome (Slice 41), not at its start: a plain chat and an
orchestrator have none. Work on a planned slice reports on the slice's own card (`<project>/slice-<N>`); any other task
is `<project>/task-<id>`, `agent: "session"`. An orchestrator runs `report-progress --orchestrator` once.

- `title`: one line saying what it is doing now ("Read the crash log on the iPhone 8").
- `outcome` (up to 200 characters): what the task delivers ("Code merged to main"); the card shows it under the title.
- `why`: what the work is for ("For Slice 12: app crashes on start"). A card with no `why`, no
  `steps` and no `outcome` has no special card any more (the "no goal reported yet" card is gone); it shows with its
  title like any other.
- `steps`: the planned steps, the whole list each time, one `active`.
- `details_md`: what is done so far, one line per bullet.
- `parent`: the session's own name ("session 9c1e") or the wave's ("wave 3"); the page shows it
  with the environment's label ("session 9c1e · Laptop"). `environment` names where it runs.
- `needs_you` (up to 2000 characters) and `after_answer` (up to 500): the agent's own question and
  what it does after the answer. The same card then shows under "Needs you" with the question in
  full; the board is read-only, so the card says "answer in that session". `needs_you: null`
  clears it; so does any report that moves the item to `in_progress` from another status (stale
  included: a session that asked is idle, goes stale, and its next report follows the answer) or
  to `done`, without a new question. A repeated `in_progress` report keeps it, so a session's
  client sends `needs_you: null` when the owner answers (on the prompt-submit hook), which covers
  an answer inside the 15 minutes. The same text sent again keeps the time first asked; a
  heartbeat with no status keeps the question. A question ends after the configured expiry with no report. The
  server writes the history rows `needs_you: <first line>` and `answered`.

A session card with no report for 15 minutes turns stale and leaves "Working now" (it sits in
the project's Done list, dashed); a stopped card with a question stays under "Needs you". Other
items keep the configured expiry (default 2 hours).

Example, on a made-up project:

```json
{"name": "report_progress", "arguments": {
  "key": "example-app/session-4f2a", "project": "example-app", "type": "unplanned",
  "title": "Find the device with the crash", "why": "For Slice 12: app crashes on start",
  "parent": "session 4f2a", "environment": "laptop", "agent": "session", "status": "in_progress",
  "steps": [{"label": "Find a device", "state": "done"}, {"label": "Ask which device", "state": "active"}],
  "needs_you": "Which iPhone should I read the crash log from?",
  "after_answer": "I read the log and write the cause into Slice 12."}}
```

### `list_open` (read or write token)

The board window: every item that is not done, plus items done inside the window.

Optional fields: `project`, `type` (enum above), `window_hours` (a positive number; the server
caps it at its configured maximum, default window 12 hours). Returns an array of items, each
with `events`: its latest 20 events, newest first.

### `get_item` (read or write token)

Field: `key` (required), `include_archived` (optional, default false: an archived item is read only with it,
and the reply then carries `archived_at`). Returns the item with `events`: its full history, newest first. An
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
  - `priority`, `parent` (display text, for example `Plan · Search`), `why`, `links`: optional; a
    field left out keeps its stored value on every sync, null clears it. `details_md` (the rest of a
    clipped title) is stored on a new key only. The limits and the allowed values are the ones in *The item*.
  - `parts` (optional, on a slice): its lettered work groups, `[{letter, title, done}]`, `letter`
    one capital letter A to Z, at most 26, only on an item of type `slice` (see *Slice parts*
    below). The 200 limit counts the items you send; the slices and their parts together may not
    pass 1000.
  - `checks` (optional, on a slice): its "not yet tried on a device" lines, `[{key, title}]`, at
    most 100 (see *Checks* below). A top-level item of type `check` names its slice in
    `parent_key`, even a slice that is not in the snapshot.

Output (a counts summary, not items): `{project, created, updated, closed, unchanged, raced, skipped}`.
`created` counts keys the board had not seen, `updated` counts existing items the sync
changed, `closed` counts items that left the snapshot, `unchanged` counts snapshot items that
needed no write. `raced` counts items whose write was skipped because a live report changed the
row between the sync's read and its write (the item is not saved; send the snapshot again). `skipped` is `[{key, reason}]`: an item or nested check that breaks a key or
parent rule is not saved and is named here with the reason (its `parent_key` names another
project or a skipped slice of the same snapshot; the stored item under its key has another type and is not
owned by the documents; a check with no slice, a key not under its slice's key plus `/`, or a parent that is no
slice; checks on an item that is not a slice; a repeated nested key). The rest of the snapshot is
saved, and a skipped key is not closed. A client should read `skipped` and show it.

Errors (tool errors, nothing written): a read token (`forbidden: this token is read-only, a
write token is required`); more than 200 items; an item whose `project` differs from the
call's (`field items: <key> has project <p>, the call is for <project>`); a repeated key; a key
that is already stored under another project; any invalid value.

`sync_snapshot` stays for older plugin copies; the plugin now sends only changes with the tools below, because a
snapshot closes everything it leaves out and so cannot be split.

### One item, a batch, and archive (Slice 50)

There is no delete: **delete means archive**. An archived item with its parts, checks, steps and events is kept
unchanged but hidden from the board page, `list_open` and every count; 30 days after it was archived the daily cron
removes it and everything under it for good. Until then `get_item` with `include_archived: true` reads it (the reply
carries `archived_at`); without the flag an archived key is `field key: no item <key>`. Archiving a key sets the same
`archived_at` on it and on the plan-owned items under it (by `parent_key`: doc-synced rows, parts and checks); a live
bug, problem, waiting or session card under it is never archived. A caller without the static write token archives only
while nothing the archive would take is doc-synced; the check is in the archive's own write, and a refused call changes
nothing. Only an explicit write of the item's content revives it: `upsert_item`, an `apply_batch` upsert, or a
`sync_snapshot` write whose document fields really changed (an unchanged item stays archived under a sync). The revive
clears `archived_at` on the key and on the items under it reached only through rows with the same time, in the same
batch; an item archived at another time stays archived, and so does everything below it. `report_progress`, `mark_done`,
`ask_human` and heartbeats on an archived key are refused (`field key: <key> is archived ...`) and write nothing;
restore it with `upsert_item` first. The purge removes rows by their own `archived_at` only, so a row archived on its
own goes on its own 30 days. It clears the `parent_key` of rows that are not doc-synced and name a purged item (a
doc-synced row keeps its own), and the cron logs how many rows it removed and how many it unlinked. A purged item that
the documents still list comes back as a new item on the next sync: the documents are the source of record.

- `upsert_item` (static write token): one doc-sync item, the same fields as a `sync_snapshot` item (parts and checks
  included). It adds or updates that item and closes nothing else. Reply `{op, key, outcome, raced}`; `outcome` is
  `created`, `updated`, `unchanged` or `raced` (the row moved between the read and the write: send it again).
- `archive_item` (write token): `key`. Archives the item and everything under it. An item from the plan documents
  needs the static write token (as `sync_snapshot` does), any other item the owner's write scope. Reply
  `{key, outcome, archived}`; `outcome` is `archived` or `already_archived` (the first archive time is kept).
- `apply_batch` (write token): `project` and `operations`, each `{op: "upsert", item}`, `{op: "close", key}` or
  `{op: "archive", key}`, every key at most once. At most 200 items per call, counted after a slice's parts and checks
  are expanded (a close or an archive counts one); more, a repeated key, an item of another project or any bad
  operation refuses the whole call and names the key, and nothing is written. The call is one atomic batch. `close`
  marks a doc-sync item done with its parts and checks (what `sync_snapshot` does to an item it leaves out); `upsert`
  and `close` need the static write token. Nothing relies on absence: only the named items are touched, so a client
  can send a large project as several calls. Reply: `{project, results[], created, updated, unchanged, closed,
  archived, raced}`, `results` one `{op, key, outcome}` per operation in the order sent.
- `list_synced` (read token): `project`, optional `after_key` and `limit` (at most 200, default 100). The project's
  top-level doc-sync items by key, `[{key, status, hash}]` (an archived one carries `archived: true`; the plugin sends
  nothing for it while its hash is unchanged and an upsert, which brings it back, when it changed); the hash covers what the documents said about the
  item (type, title, status, why, parent, links, an owner step's details, its parts and checks) and is `docHash` in
  `src/domain/docSync.ts`, mirrored in the plugin. Ask for the next page with `after_key` = the last key; an empty
  page is the end.

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

Reply text (parse it as for the other tools): `{"project":"demo-app","created":1,"updated":0,"closed":0,"unchanged":0,"raced":0,"skipped":[]}`.

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
  snapshot. An empty list closes every doc-sync item of the project, on purpose: a finished
  project has an empty status table and its cards should close. The plugin's sync says so on
  stderr when it sends one (`closed=` counts them, 0 when the board holds none). If a closed key
  returns in a later snapshot, it carries a new docs status and reopens.
- The same snapshot twice changes nothing: no write, no event, `updated_at` untouched.
- A sync records an event (source `doc-sync`) only when the shown status changes, and takes over
  the item's `source` only then.
- If a live report lands between the sync's read and its write, that item keeps the live
  status and the next sync settles it.

### `report_usage` (write token)

The tokens an agent used, as **totals so far**. The coding tool records, for every message, the
model and four token counts; a client adds them up per agent and model and sends the running
totals, never differences. Sending the same report twice stores one sample; a lost report is
healed by the next one; the use between two times is a subtraction the board makes when it
reads.

| Field | Required | Notes |
| --- | --- | --- |
| `agent_key` | yes | `<project>/session-<id>` for a main session, `<project>/session-<id>/agent-<id>` for a helper |
| `model` | yes | the model name as the tool records it (up to 100 characters) |
| `record_at` | yes | ISO time of the newest record these totals counted |
| `input_tokens` | yes | fresh input, running total (whole number, 0 or more) |
| `cache_write_tokens` | yes | written to the cache, running total |
| `cache_read_tokens` | yes | read from the cache, running total |
| `output_tokens` | yes | output, running total |
| `task_key` | no | item key of the task the tokens were for (a slice or a slice part) |
| `agent_kind` | no | kind of agent, for example `reviewer` |
| `step` | no | the step the agent was on, when known |
| `environment` | no | where it ran (see `report_progress`); a report with none counts as the board's main machine |

Returns `{stored}`: true for a new sample, false when one with the same agent key, model,
environment and `record_at` was already stored (the first one stays). One agent key reported
from two environments is two series. A running total that goes down for the same series is a
restart: the new totals count from zero, never as negative use. Helpers report under the same
`task_key` as their parent, with their own `agent_key` and model.

**What to send and how often.** About every five minutes while work runs, and once when the
agent stops (a client's last report is the one that closes the numbers). Totals are per agent
and model: one report per model an agent used. Fail open, as for every client.

### `report_cap` (write token)

One reading of the subscription's cap: the time it was taken, the plan name and the percent
used of each window the client can read.

| Field | Required | Notes |
| --- | --- | --- |
| `taken_at` | yes | ISO time the reading was taken |
| `plan` | yes | the plan's name as the client reads it (1 to 100 characters); recorded on every reading |
| `windows` | yes | 1 to 20 of `{kind, percent, reset_at?}`: `kind` `weekly` is the weekly cap, `short` any shorter window, any other name is stored but not shown; `percent` 0 to 100 with decimals |
| `source` | no | what took the reading |

Returns `{stored, windows}`: how many windows were new. The board keeps the raw readings and
works out which count: ordered by `taken_at`, a reading lower than one already stored in the same
window is dropped as stale; a lower reading starts a new window when its `reset_at` differs from
the stored one, or, with no `reset_at`, when it falls to the low mark (config `usage.lowMarkPercent`,
default 2) from above it. So 98% to 1% is a reset and 60% to 55% is a stale reading. Send a
reading whenever one is read; the plan name matters because 1% of one plan is not 1% of another.

### Reading usage (the page's route)

`GET /api/usage` (behind the same Access check as `/api/board`; not an MCP tool) takes `range`
(`24h`, `window` default, `30d`), `plan` (default: the plan of the newest accepted reading),
`environment` (default: all) and `utc_offset` (minutes east of UTC, so the days are the
viewer's days). It answers with tokens per day (per hour for `24h`) split by model, token kind,
agent kind and environment, totals, the top tasks, the environments and plans seen, the cap
readings by window with the dropped ones and the percent each lost to, and the series colours
from config. Config keys, all optional, under `usage` in `BOARD_CONFIG`: `series`, `topTasks`,
`baseEnvironment`, `environmentLabels`, `lowMarkPercent`, `keepDays`, `capCost` (see
`config/board.example.json`).

#### What 1% of the cap costs (Slice 9)

The same route returns `cap_cost`: per plan, how many tokens of each model use 1% of the cap,
how sure that is, the multiplier per environment, the cap growth no report explains, and
`cap_points` (percent of the cap) per task, agent kind and step. It is a best fit worked out on
every read: the board takes stretches of time inside one window on one plan, each with an
accepted weekly cap reading at both ends, and finds the non-negative weights (per model, and
per token kind once a model has three times four stretches) that explain the growth best.
A reset or a plan change never lies inside a stretch, so no cost is negative.

What a client must send for it to work:

- **Regular cap readings with the plan name** (`report_cap`, every few minutes while it
  works). A stretch needs a reading at each end, at least `capCost.minStretchMinutes` apart with
  the cap risen by `capCost.minGrowthPoints`; with fewer than `capCost.minStretches` stretches
  the page says the estimate is not ready.
- **The `environment` on every `report_usage`.** Without it a report counts as the main
  machine, so cloud use is mistaken for main-machine use. An environment gets its own
  multiplier only with `capCost.environmentMinStretches` stretches that hold its use and a
  different mix of environments between stretches.
- **Usage reports for every model and token kind**, from every machine that spends the cap.

What it cannot see: Claude chat on desktop or phone, Claude Design, and machines without the
client. Their use raises the cap with no report; the board shows it as "not explained" (a share
of the growth, and the stretches where it was largest) instead of blaming a model. A model seen
only outside any stretch has no weight, so its tasks show 0%. Config keys under
`usage.capCost`: `minStretches`, `environmentMinStretches`, `fineFactor`, `sure`
(`minStretches`, `maxLeftoverShare`), `unexplainedStretches`, `minStretchMinutes`,
`minGrowthPoints`, `convergence`.

## Slice parts (Slice 11)

A slice's work list is often lettered groups (A, B, C and so on) built one after another, sometimes
by different agents. The board shows how many are done and leads from the slice to the one an agent
holds now.

- **The documents say which parts exist and which are done.** A client that parses a slice's work
  list sends the groups with `sync_snapshot`, in the slice's item: `parts: [{letter: "A", title:
  "Server", done: true}, ...]`. A part is done when all its checkboxes are ticked. Each part
  becomes an item of type `part` with the key `<slice key>/part-<letter>` (for example
  `demo-app/slice-58/part-B`), `parent_key` the slice's key, its title and its done state owned by
  the documents. A part that is not in the next snapshot of its slice is closed, the same as a
  slice that left the table. A snapshot item with no `parts` field leaves the slice's stored parts
  alone; an explicit empty array (`parts: []`) closes them all. A slice that never had parts has no
  bar.
- **Live reports say which part is active.** An agent that works on a part reports on the part's
  key with `report_progress`: `status` `in_progress`, its `steps`, `agent` and `model` (the same as
  for any task, see *Steps*), and `parent_key` set to the slice's key (needed only when the
  snapshot has not created the part yet; the parent, when it exists, must be in the same project).
  The part is active while the working-now rule holds
  for it; when its report stops past the stale expiry it reads stale, and its slice's tile and
  drawer say so. The slice's own status is never changed by a part: the board shows the slice as
  in flight while a part is active, and its stored status stays as reported.
- **Progress** is parts done over parts, worked out when the board is read (one of five done is
  20%); the part in progress adds nothing until it is done.
- The board's `parts` field on a slice lists each part (`key`, `letter`, `title`, `state` of
  `done`, `active`, `stale` or `pending`, and for an active or stale one its current `step` and
  `steps_done` of `steps_total`), with `parts_progress` and `active_part_key`. A part's own item
  carries its slice as `parent_key` and, as `parent_slice`, the slice as data (`key`, `number` from
  a key ending in `slice-N` or null, `title`); the page words it. Only parts the documents list
  count in a slice's `parts` and progress; a part only a live report named shows on the Active
  work view while it works and is never in the slice's list.
- Parts have no tile on the board page. An active part is a card on the Active work view, and the
  slice's tile and drawer link to it (`#/active/<key>` opens the view with that card expanded).
- Send a part's usage with `task_key` set to the part's key.

## Checks (Slice 14)

A "not yet tried on a device" line is a check, never a card. A made-up snapshot with parts and checks:

```json
{
  "project": "demo-app",
  "items": [
    {
      "key": "demo-app/slice-58",
      "project": "demo-app",
      "type": "slice",
      "title": "Slice 58 · Add the export button",
      "status": "in_progress",
      "parts": [
        {"letter": "A", "title": "Export service", "done": true},
        {"letter": "B", "title": "Button and menu", "done": false}
      ],
      "checks": [
        {"key": "demo-app/slice-58/check-1", "title": "Export 500 rows on a phone"},
        {"key": "demo-app/slice-58/check-2", "title": "Export with no network"}
      ]
    },
    {
      "key": "demo-app/slice-40/check-1",
      "project": "demo-app",
      "type": "check",
      "title": "Dark theme on the tablet",
      "status": "open",
      "parent_key": "demo-app/slice-40"
    }
  ]
}
```

- A check is an item of type `check`; `parent_key` names its slice and is required (a report with no
  `parent_key` on a check, or one that clears it, is refused). Its key is the client's and must stay the
  same each sync.
- A check that leaves the snapshot is closed like a part. A slice item with no `checks` field leaves its
  stored checks alone; `checks: []` closes them all (the field's presence, even empty, is what decides).
- Any `parent_key` must name an item of the same project, and a check's must be a slice whose key plus
  `/` starts the check's key (a parent that exists nowhere yet is allowed). `report_progress` checks the
  item's final state (stored row plus the report), so a retype or re-parent is refused with the reason;
  `sync_snapshot` skips the item and lists it in `skipped`. A cycle of any length (to a bounded depth)
  is refused, and a report that leaves the stored type, project and `parent_key` as they are is never
  refused for what an older row already holds. A key stored as another type that the documents do not own
  is never retyped by a snapshot: the item is skipped, with a `type:` reason.
- A check or part that holds a `needs_you` question is listed in the project's `needs_you`.
- The board does not list checks as items. A slice's `checks` field lists the ones not tried (open or in
  progress; a blocked or stale one is not counted). A done slice with any check that is not done is listed
  under `built`; only a check whose slice is not on the board at all is counted in the project's
  `loose_checks`.
- A `bug` or `problem` may name the slice planned for it in `parent_key`; the board returns that slice
  as `parent_slice` (null when the key names no slice on the board).
- `GET /api/board` also returns `groups`, one per project, which the page draws without regrouping:
  `needs_you`, `working_now`, `planned`, `built`, `loose_checks`, `problems`, `other`, `done` and `summary`.
  `built` lists the done slices that still have at least one check not tried, by slice number (each as a planned
  slice does, with its checks); such a slice is in no other list, and `summary.built` counts them. The summary's
  keys are `needs_you`, `working`, `planned`, `built`, `problems` and `checks_not_tried`; `checks_not_tried` counts
  the checks of planned and built slices and the loose ones.

## Keys

A key is chosen by the reporter and must be the same every time the same thing is reported:

- `<project>/slice-<N>`: a planned slice, for example `demo-app/slice-58`
- `<project>/slice-<N>/check-<hash>`: one verification check of a slice (`<hash>` is whatever stable hash
  the client derives from the check's text)
- `<project>/slice-<N>/part-<letter>`: one lettered part of a slice, `<letter>` a capital A to Z (see
  *Slice parts*)
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
- **A session needs a person:** `report_progress` on the session's own key with `needs_you` (and
  `after_answer`); the card stays one card. `ask_human` on a key of another type does the same.
  A step only the person can do (a console step) is still a `waiting_for_me` item through
  `ask_human` on its own key; `mark_done` once done.
- **A session finished:** `mark_done` on `<project>/session-<id>`, only when the goal is done and
  no background agent is still working; never at the end of a reply or turn.
- **A session still running:** a `report_progress` with the `key` and `status: "in_progress"` as a heartbeat (a bare key does
  not bring a stale card back), at
  least once per expiry (default 2 hours), or the item turns stale. A session card
  (`agent: "session"`) expires after 15 minutes, so heartbeat it at least every 5 while working; a
  client that cannot keep time reports at every step change and before and after a long wait,
  never on every tool call.

## Cloud sessions

For Claude Code cloud sessions (Claude Code on the web). The step-by-step guide for a Claude Code to
follow, including usage reports under their own label (`AGENT_BOARD_ENV`), is
[setup/cloud.md](setup/cloud.md) (Slice 28: plan/slices/28-cloud-usage.md); a cloud session does not install
the board's plugin, so it runs the plugin's scripts directly. The setup belongs to the client repo
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

## Planned, not built yet (Slices 9 to 11)

Nothing in this section exists on the board today. Do not send any of it yet: the tools do not
read it yet. It is here so a client author can see what is coming. The tools
described above are unchanged.

- **`environment`** (built in [Slice 8](plan/slices/08-usage-reports.md), see `report_usage`):
  it comes from the client's own config and is never hard-coded in a client or on the board:
  the board shows the value as sent (or a label the board's owner maps to it) and treats the
  environment named in its config (else the busiest one) as the main machine.
- Built in [Slice 9](plan/slices/09-cap-cost-estimate.md): what 1% of the cap costs, per model
  and environment (see *What 1% of the cap costs* under *Reading usage*).
- Built in [Slice 10](plan/slices/10-task-steps.md): task steps, `agent` and `model` (see *Steps*
  under `report_progress`).
- Built in [Slice 11](plan/slices/11-slice-parts.md): slice parts, `parts` in the snapshot and
  `parent_key` (see *Slice parts*).
- Built in [Slice 14](plan/slices/14-checks-in-slice.md): checks inside their slice, bugs and problems
  naming a slice, and the board's `groups` (see *Checks*).
