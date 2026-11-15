### Slice 6 — Reporting from Claude Code cloud sessions

Source: phone scope (2026-11-15), milestone 6 — see [Slice 1](01-items-api.md).

*Built 2026-11-15, PR #37 (not merged); not yet verified in a cloud session.*

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

*Changed by the docs re-check (2026-11-15):*

- (a) The default level is Limited with package registries, GitHub and cloud SDKs. The board
  host goes in the environment's Allowed domains.
- (b) A repo `.mcp.json` loads in a single-repository session; user-scoped servers do not. The
  "(check)" above is answered yes.
- (c) Plain environment variables are NOT secret ("Anyone who uses the environment can read the
  values"). Network secrets are the secret store, but the docs read do not say how a network
  secret reaches a request. The guide names this as an open point for the client author; the
  hard constraint (token never in a repo or a prompt) still holds.
- (d) Repo SessionStart hooks run in cloud sessions; user-level hooks do not.

#### Cloud docs re-check (2026-11-15)

Pages read: https://code.claude.com/docs/en/cloud-environments,
https://code.claude.com/docs/en/claude-code-on-the-web,
https://code.claude.com/docs/en/settings#settings-in-cloud-sessions

1. **Network:** levels None, Limited, Full; a new environment starts at Limited with *Allow
   package managers* checked (package registries, GitHub, cloud SDKs plus listed domains).
   Custom hosts go one per line in *Allowed domains* (`*.` matches subdomains). Each
   environment has its own list.
2. **Variables and secrets:** variables (`.env` format) are readable by anyone who uses the
   environment. Network secrets are a separate store, not shown again after saving and not in
   the session's environment or files; not available with customer-managed keys.
3. **MCP:** a repo `.mcp.json` loads in a single-repository session; servers added with
   `claude mcp add` (user or local scope) do not. claude.ai connectors also work.
4. **Hooks and setup:** repo `.claude/settings.json` SessionStart hooks run; user-level hooks
   do not. The setup script is set on the environment; whether a repo file can serve as it is
   not documented.

#### Work

- [x] Re-check the current cloud environment docs (network allowlist, secrets, whether a
      project `.mcp.json` loads) and write the answer here.
- [x] `docs/clients.md` section "Cloud sessions".

#### Verification

- A slice built in a cloud session updates its tile.

Built: docs only, section "Cloud sessions" in `docs/clients.md` (48 lines); lint, typecheck and
`npm test` green (33 tests). No review passes (docs-only change).

#### Not yet verified

- A slice built in a cloud session updates its tile; waits for the first deploy and the client
  in the owner's config repo.
- How a network secret reaches an outgoing request: read the docs' "Add network secrets"
  section and try it in one real cloud session (client author).
