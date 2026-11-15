# Not yet verified

Every open "Not yet verified" check, one block per slice. A check that passes, or that the
owner confirms, is removed here and its slice marked `verified`.

### Slice 5: OAuth so claude.ai can use the MCP server ([slice](slices/05-remote-mcp.md))

- wrangler provisions the `OAUTH_KV` namespace on the first `deploy:ci` run. Seen 2026-11-15: `POST /oauth/register` answers 201, which needs the KV. Not seen: the namespace itself (needs wrangler).
- The per-request env copy works on the deployed Worker (proven only in the Vitest Workers pool). Seen 2026-11-15: register, discovery, authorize and token routes answer repeatedly without error. Not seen: a full grant (the passphrase POST was not run).
- claude.ai accepts the connector (registration, the 401 pointer on POST, 405 on GET, consent page, token) and "what's waiting for me?" lists the right items from claude.ai mobile.
- A static bearer token with `public_origin` set and a different request host still gets through (check-2 finding 8).

### Slice 7: Stale detection ([slice](slices/07-stale-detection.md))

- The cron trigger registers on deploy and fires (waits for the first deploy).
- A killed session's item turns stale within the expiry and recovers on the next report, on the live board.
- The account's free-plan limit of 5 cron triggers is not exceeded.

### Slice 2: Tile board page ([slice](slices/02-tile-board.md))

- Seeded data shows correctly on the owner's phone, opened from the deployed URL through Access (drawer and waiting strip included); blocked until the Access application exists.
- Opening the page without passing Access is refused, checked through Access itself.
- The custom domain is attached to the Worker and a pipeline deploy leaves it attached.
- The first pipeline run of the new `deploy:ci` (`vite build`, then migrations, then deploy with `web/dist/agent_progress_board/wrangler.json`); locally `vite build` and `wrangler deploy --dry-run` passed. Seen 2026-11-15: the check "Workers Builds: agent-progress-board" on c1cc5de succeeded and the Worker is live with migrations applied. Not seen: the pipeline log.
- Worker secrets (`ACCESS_*`, `BOARD_CONFIG`) survive a pipeline deploy. Seen 2026-11-15: `BOARD_WRITE`/`BOARD_READ` tokens and the `OWNER_PASSPHRASE` page work after the deploy. Not seen: `ACCESS_*` and `BOARD_CONFIG` (the Access guard answers 403).
- The seed script run against the deployed Worker.
- The Node version in `engines` (`>= 22.18.0`): the number comes from the review and the fixer's knowledge; context7 confirmed only that type stripping is default in Node 24.

### Slice 4: Doc sync: `sync_snapshot` tool ([slice](slices/04-doc-sync.md))

- Migration 0002 applied to the remote D1 by the pipeline. Seen 2026-11-15: `sync_snapshot` works against the remote D1. Not seen: the migration record itself.

### Slice 6: Reporting from Claude Code cloud sessions ([slice](slices/06-cloud-sessions.md))

- A slice built in a cloud session updates its tile; waits for the first deploy and the client
  in the owner's config repo.
- How a network secret reaches an outgoing request: read the docs' "Add network secrets"
  section and try it in one real cloud session (client author).

### Slice 3: Client handover: tool reference and client guide ([slice](slices/03-reporter.md))

- A client written only from the guide reports a real run and its tiles move live (waits for the first deploy and for the client in the owner's config repo).

### Slice 1: Worker + D1 items store behind an MCP endpoint ([slice](slices/01-items-api.md))

- The Claude Code `claude mcp add --transport http` check against the deployed URL (the curl checks passed 2026-11-15).
- That the Workers Builds build token can apply D1 migrations (`npm run deploy:ci`). Seen 2026-11-15: the tables exist after the pipeline deploy. Not seen: the pipeline log.
- That `wrangler deploy` binds the existing database by name (no `database_id`). Seen 2026-11-15: the Worker reads and writes D1 after the pipeline deploy. Not seen: `wrangler.json` was not inspected.
