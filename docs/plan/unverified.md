# Not yet verified

Every open "Not yet verified" check, one block per slice. A check that passes, or that the
owner confirms, is removed here and its slice marked `verified`.

### Slice 5: OAuth so claude.ai can use the MCP server ([slice](slices/05-remote-mcp.md))

- wrangler provisions the `OAUTH_KV` namespace on the first `deploy:ci` run.
- The per-request env copy works on the deployed Worker (proven only in the Vitest Workers pool).
- A bearer token still works against the deployed `/mcp`.
- claude.ai accepts the connector (registration, the 401 pointer on POST, 405 on GET, consent page, token) and "what's waiting for me?" lists the right items from claude.ai mobile.
- A static bearer token with `public_origin` set and a different request host still gets through (check-2 finding 8).

### Slice 7: Stale detection ([slice](slices/07-stale-detection.md))

- The cron trigger registers on deploy and fires (waits for the owner connecting Workers Builds).
- A killed session's item turns stale within the expiry and recovers on the next report, on the live board.
- The account's free-plan limit of 5 cron triggers is not exceeded.

### Slice 2: Tile board page ([slice](slices/02-tile-board.md))

- Seeded data shows correctly on the owner's phone, opened from the deployed URL through Access (drawer and waiting strip included); blocked until the Access application exists.
- Opening the page without passing Access is refused, checked through Access itself.
- The first pipeline run of the new `deploy:ci` (`vite build`, then migrations, then deploy with `web/dist/agent_progress_board/wrangler.json`); locally `vite build` and `wrangler deploy --dry-run` passed.
- Worker secrets (`ACCESS_*`, `BOARD_CONFIG`) survive a pipeline deploy.
- The seed script run against the deployed Worker.
- The Node version in `engines` (`>= 22.18.0`): the number comes from the review and the fixer's knowledge; context7 confirmed only that type stripping is default in Node 24.

### Slice 4: Doc sync: `sync_snapshot` tool ([slice](slices/04-doc-sync.md))

- With a client: a repo with no live events shows its open slices and unverified checks after one sync; a second sync changes nothing; a slice removed from the repo's table turns done.
- Migration 0002 applied to the remote D1 by the pipeline.
- A 200-item snapshot against deployed D1 (local D1 passed).

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
