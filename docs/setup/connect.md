# Connect a Claude Code to a board

Written for a Claude Code with no context. A person asked you to connect their Claude Code to an agent
progress board that already exists. You install one plugin, `agent-board`, which adds the board as an MCP
server and a skill with the reporting rules. Do the steps in order and stop at the first one that fails;
tell the person what failed.

A guide for setting up a board of your own (Cloudflare account, secrets) is coming; it does not exist yet. This
page is only for connecting to a board that is already running.

## 1. Check the Claude Code version

Run `claude --version`, then `claude plugin configure --help`. This guide was tested on 2.1.326; the plugin
commands below, including `configure --values-stdin`, must exist. On 2.1.326 only these were run: adding the
plugin from a local path (not from GitHub), `configure` with the pipe form of `--values-stdin`, and `claude mcp
list` showing the board Connected. Not run: adding the marketplace from GitHub, the stdin-from-a-file form, the
`/plugin` menu, and a session using the skill; if one of those fails, say which, do not blame the person. If `claude plugin` or that flag is missing,
tell the person to update Claude Code and stop.

## 2. Get the two values

Never guess these and never read them from another project.

- **Board address:** ask the person for it in chat. It must start with `https://` (an `http://` address would send
  the token in cleartext, so refuse it) and end before `/mcp`, with no trailing slash (for example
  `https://board.example.com`). If the person gives a trailing slash, strip it before saving. It comes from
  whoever runs the board.
- **Write token:** the board's write token. A person who runs their own board finds it in their secrets store (it
  is the Worker secret `BOARD_WRITE_TOKEN`); otherwise whoever runs the board hands it out. The read token is not
  enough: reporting needs the write token. Do not ask for it in chat: the person types it in themselves in step 4,
  so it never reaches the conversation, a command line or the shell history.

Never print the token back, write it to a file in a repository, or put it in a command line.

## 3. Add the marketplace and install the plugin

```
claude plugin marketplace add ashkansirous/agent-progress-board
claude plugin install agent-board@agent-progress-board
```

Both work without prompts. The install succeeds even though the two options are not set yet.

## 4. Save the two values

Tell the person to open `/plugin`, Installed, agent-board, Configure options, and type both values there: the board
address (https, no trailing slash, ending before `/mcp`) and the write token. This is the route to use: the token
goes straight into the system's secure store (the address into the user settings) and never into your tool calls,
the transcript or the shell history. `claude plugin configure agent-board@agent-progress-board` with no flags shows
which options are still unset; use it to check afterwards.

Do not use `--config board_token=...` on `install`, and do not pipe the token through `echo` into
`--values-stdin`: both put it in the command text. If the person cannot use `/plugin`, they can write a one-line
JSON file themselves, `{"board_url": "<address>", "board_token": "<token>"}`, outside any repository, and you run
`claude plugin configure agent-board@agent-progress-board --values-stdin < <that file>` (this file form was not
tested; the pipe form was), then the person deletes the file.

## 5. Keep the plugin current (optional)

New versions of the plugin reach the person through Claude Code's plugin update. Updates are off by default for
a marketplace that is not Anthropic's. Tell the person they can turn them on in `/plugin`: Marketplaces,
agent-progress-board, Enable auto-update. That is a menu in the app, not a command; it is their choice. Without
it, update by hand when told to:

```
claude plugin marketplace update agent-progress-board
claude plugin update agent-board@agent-progress-board
```

A plugin update takes effect after a restart (or `/reload-plugins` inside a session).

## 6. Load it and test

Ask the person to restart Claude Code, or run `/reload-plugins` inside a session. Then check
`claude mcp list`: `plugin:agent-board:agent-board` must show Connected. If it shows a failure, the address or the
token is wrong (the address must end before `/mcp`, the token must be the write token): redo step 4.

Then prove it works with a test card, using the board's tools (the skill `agent-board` has the rules):

1. `report_progress` with key `connect-test/session-<random id>`, project `connect-test`, type `unplanned`,
   agent `session`, status `in_progress`, title "Connection test", why "Check that this Claude Code reports to
   the board", and one step as `{label, state}`, for example `[{"label": "Test the connection", "state":
   "active"}]` (a step without a `state` is refused).
2. `get_item` with the same key: the card must come back with that title.
3. `mark_done` with the same key.
4. Tell the person it worked, and that a card "Connection test" now sits under the project `connect-test` on
   their board (done cards leave the board after the done window).

If any call is refused, say which one and the refusal text. A refusal for a read-only token means the person
gave you the read token.

## Adding the board to claude.ai too

claude.ai connects through OAuth, not through this plugin: Settings, Connectors, add a custom connector with
`<board address>/mcp`. The sign-in steps and the instruction text to paste are in
[docs/clients.md](../clients.md), *Adding the board to claude.ai*.
