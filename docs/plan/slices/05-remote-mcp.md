### Slice 5 — OAuth so claude.ai can use the MCP server

Source: phone scope (2026-11-15), milestone 5 — see [Slice 1](01-items-api.md). The MCP
endpoint and its tools ship in Slice 1; this slice adds what claude.ai needs.

*Planned.*

**Touches:** `src/auth/**`, `src/api/**`, `wrangler.jsonc`, `package.json`,
`package-lock.json`, `test/**`, `README.md`, `docs/clients.md`

#### Why

Ask "what's waiting for me?" from claude.ai on the phone.

#### Decisions

- claude.ai custom connectors connect from Anthropic's cloud and authorise with OAuth, so the
  endpoint needs OAuth alongside the bearer tokens (the Worker's public HTTPS URL already
  meets the "443, public" need).
- Only the owner can authorise: identity checked through Cloudflare Access or a one-owner
  allow rule from config.
- Bearer tokens keep working for Claude Code and scripts.
- Re-check before building: the current OAuth provider library for Workers
  (`workers-oauth-provider` or what context7 shows) and the MCP auth spec version claude.ai
  expects.

#### Work

- [ ] context7 / `library-docs` for the Workers OAuth provider and MCP auth.
- [ ] OAuth flow with tests; bearer auth unchanged.
- [ ] `docs/clients.md` and README: adding the board to claude.ai.

#### Verification

- Tests green; Claude Code with a bearer token still works.
- From claude.ai mobile, "what's waiting for me?" lists the right items.
