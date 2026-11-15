### Slice 6 — Reporting from Claude Code cloud sessions

Source: phone scope (2026-11-15), milestone 6 — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `README.md`

#### Why

Coding agents may build slices in Claude Code cloud sessions; their tiles must move too.

#### Where it is built

The setup (allowlist, environment secrets, installing the reporter) is in the owner's private
config repo. This repo only documents it for other users.

#### Decisions

- Cloud sessions don't load user-scoped MCP servers and the default network level allows only
  package registries and GitHub, so a cloud session reports through the HTTP client: the board
  host goes on the environment's custom allowlist and `AGENT_BOARD_URL` / `AGENT_BOARD_TOKEN`
  go in as environment secrets.
- **Hard constraint:** the token is an environment secret, never in a repo or a prompt.

#### Work

- [ ] README section "Cloud sessions": the allowlist entry and the two secrets (re-check the
      current cloud environment docs first).

#### Verification

- A slice built in a cloud session updates its tile.
