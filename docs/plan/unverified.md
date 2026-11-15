# Not yet verified

Every open "Not yet verified" check, one block per slice. A check that passes, or that the
owner confirms, is removed here and its slice marked `verified`.

### Slice 1: Worker + D1 items store behind an MCP endpoint ([slice](slices/01-items-api.md))

- The whole "Against the deployed Worker" list of Verification.
- The Claude Code `claude mcp add --transport http` and curl checks against the deployed URL.
- That the Workers Builds build token can apply D1 migrations (`npm run deploy:ci`).
- That `wrangler deploy` binds the existing database by name (no `database_id`).
