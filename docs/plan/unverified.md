# Not yet verified

Every open "Not yet verified" check, one block per slice. A check that passes, or that the
owner confirms, is removed here and its slice marked `verified`.

### Slice 6: Reporting from Claude Code cloud sessions ([slice](slices/06-cloud-sessions.md))

- A slice built in a cloud session updates its tile; waits for the first deploy and the client
  in the owner's config repo.
- How a network secret reaches an outgoing request: read the docs' "Add network secrets"
  section and try it in one real cloud session (client author).

### Slice 3: Client handover: tool reference and client guide ([slice](slices/03-reporter.md))

- A client written only from the guide reports a real run and its tiles move live (waits for the first deploy and for the client in the owner's config repo).
- The curl example in `docs/clients.md` run against the deployed Worker (it was not run against a live server).

### Slice 1: Worker + D1 items store behind an MCP endpoint ([slice](slices/01-items-api.md))

- The whole "Against the deployed Worker" list of Verification.
- The Claude Code `claude mcp add --transport http` and curl checks against the deployed URL.
- That the Workers Builds build token can apply D1 migrations (`npm run deploy:ci`).
- That `wrangler deploy` binds the existing database by name (no `database_id`).
