### Slice 3 — Client handover: tool reference and client guide

Source: phone scope (2026-11-15), milestone 3, changed at the desk the same day — see
[Slice 1](01-items-api.md).

*Built (wave 2026-11-15), merged as PR #36 (e59a231); not yet verified: no client has been written from the guide yet.*

**Touches:** `README.md`, `docs/clients.md`

#### Why

The board exposes everything through MCP; clients are built by the repos that want one (the
owner's private Claude Code config repo first, any other repo later). This slice hands that
work over: one page a client author can build from without reading the server code.

#### Decisions

- **Hard constraint: clients fail open** (`CLAUDE.md`, *Reporters fail open*): a timeout of a
  few seconds, errors swallowed, exit 0; a missing URL or token means do nothing.
- Clients read `AGENT_BOARD_URL` and `AGENT_BOARD_TOKEN` from the environment; never a token in
  a repo.
- Two ways to call, same endpoint and tools: as an MCP server (interactive Claude Code,
  claude.ai), or a plain HTTPS POST of an MCP `tools/call` (hooks, scripts, cloud sessions
  that don't load MCP servers).
- Keys: `<project>/slice-<N>`, `<project>/slice-<N>/check-<hash>`, `<project>/session-<id>`,
  the same ones `sync_snapshot` (Slice 4) uses, so a live report and a doc-read slice are one
  tile.
- What to report and when (slice claimed, in review, merged, parked; a session waiting on a
  person; a session finished) is described as guidance, not code: each client repo decides.
- **Decided while building (2026-11-15):** `AGENT_BOARD_URL` is the base URL with no trailing
  slash and no `/mcp`; the client appends `/mcp`.
- **Decided while building (2026-11-15):** the `<hash>` in `check-<hash>` is any stable hash the
  client derives; the server defines no format.
- **Decided while building (2026-11-15):** `sync_snapshot` is left out of the guide;
  plan-not-needed: 4 adds its own section.

#### Work

- [x] `docs/clients.md`: env variables, both call styles with examples, every tool with its
      input and output, the key format, fail-open, what to report when.
- [x] README links to it.
- [x] Tell the owner's config repo it can start its client (its own planned slice already
      exists there; no code from this repo goes into it). In an unattended run this is one
      line under *Outstanding work* in `plan.md` saying the guide is ready; nothing is written
      to another repo.

#### Verification

- A client written only from `docs/clients.md` (the owner's config repo's) reports a real
  coding-agent run and its slices move on the board live.

*Changed while building:* docs only, no code changed; `docs/clients.md` is 210 lines (rules for
every client, both call styles, responses and errors, the item, the five tools, keys, what to
report when). Examples were checked against `src/mcp`, `src/api` and the tests' request shape,
and the POST headers against the MCP SDK source (both Accept values, JSON content type). Lint,
typecheck and `npm test` green (33 tests). No review passes (docs-only change).

#### For plan.md (lifted 2026-11-15)

- *Outstanding work* line: the client guide (`docs/clients.md`) is ready; the owner's config
  repo can start its client. Nothing was written to another repo. (Work item 3 closes with the
  index pass.)

#### Not yet verified

- A client written only from the guide reports a real run and its tiles move live (waits for the first deploy and for the client in the owner's config repo).
- The curl example in `docs/clients.md` run against the deployed Worker (it was not run against a live server).
