### Slice 6 — Reporting from Claude Code cloud sessions

Source: phone scope (2026-11-15), milestone 6 — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `docs/clients.md`, `README.md`

#### Why

Coding agents may build slices in Claude Code cloud sessions; their tiles must move too.

#### Where it is built

The setup (allowlist, environment secrets, installing the client) belongs to the client repo.
This repo only documents it.

#### Decisions

- Cloud sessions don't load user-scoped MCP servers and the default network level allows only
  package registries and GitHub. The board host goes on the environment's custom allowlist and
  `AGENT_BOARD_URL` / `AGENT_BOARD_TOKEN` go in as environment secrets. The client either
  loads the board as a project-scoped MCP server (if cloud sessions load those; check) or posts
  `tools/call` over HTTPS to the same endpoint.
- **Hard constraint:** the token is an environment secret, never in a repo or a prompt.

#### Work

- [ ] Re-check the current cloud environment docs (network allowlist, secrets, whether a
      project `.mcp.json` loads) and write the answer here.
- [ ] `docs/clients.md` section "Cloud sessions".

#### Verification

- A slice built in a cloud session updates its tile.
