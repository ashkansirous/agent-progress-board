### Slice 3 — Client handover: tool reference and client guide

Source: phone scope (2026-11-15), milestone 3, changed at the desk the same day — see
[Slice 1](01-items-api.md).

*In progress (wave 2026-11-15), draft PR.*

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

#### Work

- [ ] `docs/clients.md`: env variables, both call styles with examples, every tool with its
      input and output, the key format, fail-open, what to report when.
- [ ] README links to it.
- [ ] Tell the owner's config repo it can start its client (its own planned slice already
      exists there; no code from this repo goes into it). In an unattended run this is one
      line under *Outstanding work* in `plan.md` saying the guide is ready; nothing is written
      to another repo.

#### Verification

- A client written only from `docs/clients.md` (the owner's config repo's) reports a real
  coding-agent run and its slices move on the board live.
