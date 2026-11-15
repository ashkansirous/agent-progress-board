### Slice 5 — Remote MCP endpoint, then OAuth for claude.ai

Source: phone scope (2026-11-15), milestone 5 — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `src/mcp/**`, `src/api/**`, `src/auth/**`, `wrangler.jsonc`, `package.json`,
`package-lock.json`, `test/**`, `README.md`

#### Why

Ask "what's waiting for me?" from claude.ai on the phone, and give interactive Claude Code
sessions a tool instead of a CLI call.

#### Decisions

- Tools: `report_progress` (the upsert), `mark_done`, `ask_human` (creates a waiting_for_me
  item), `list_open` (the board window, filterable by project and type). All call the same
  application functions as REST.
- Part A: bearer token auth for Claude Code (same write/read scopes as Slice 1).
- Part B: OAuth so it can be added as a claude.ai custom connector; claude.ai connects from
  Anthropic's cloud, so it needs a public HTTPS URL on 443 (the Worker's URL is).
- Re-check before building: the current remote MCP library for Workers (Cloudflare Agents SDK
  / `workers-oauth-provider`) and the MCP auth spec version claude.ai expects.

#### Work

- [ ] context7 / `library-docs` for the Workers remote MCP and OAuth provider libraries.
- [ ] Part A: MCP endpoint with the four tools and bearer auth; tests.
- [ ] Part B: OAuth flow (only the owner can authorise; identity checked through Cloudflare
      Access or a one-owner allow rule from config); tests.
- [ ] README: adding it to Claude Code and to claude.ai.

#### Verification

- Tests green; Claude Code with the MCP server added can report and list.
- From claude.ai mobile, "what's waiting for me?" lists the right items.
