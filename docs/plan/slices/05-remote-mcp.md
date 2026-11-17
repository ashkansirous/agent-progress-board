### Slice 5 — OAuth so claude.ai can use the MCP server

Source: phone scope (2026-11-15), milestone 5 — see [Slice 1](01-items-api.md). The MCP
endpoint and its tools ship in Slice 1; this slice adds what claude.ai needs.

*Built, merged (PR #42, 9951aa2) and deployed (first deploy 2026-11-15, c1cc5de). The owner added the board as a custom connector in claude.ai, signed in with the passphrase, asked "what's waiting for me on the agent progress board?" in a claude.ai chat and reported "it worked" (owner, 2026-11-16). The device was not said, so the claude.ai phone check is still open.*

**Touches:** `src/**`, `wrangler.jsonc`, `vitest.config.ts`, `.dev.vars.example`, `package.json`,
`package-lock.json`, `test/**`, `README.md`, `docs/clients.md`

#### Why

Ask "what's waiting for me?" from claude.ai on the phone.

#### Decisions

- claude.ai custom connectors connect from Anthropic's cloud and authorise with OAuth, so the
  endpoint needs OAuth alongside the bearer tokens (the Worker's public HTTPS URL already
  meets the "443, public" need).
- Only the owner can authorise: identity checked by a one-owner allow rule from config
  (owner, 2026-11-15; not Cloudflare Access, so this slice does not wait for the Access
  setup). The owner's identity is private config, never in the repo.
- Bearer tokens keep working for Claude Code and scripts.
- Re-check before building: the current OAuth provider library for Workers
  (`workers-oauth-provider` or what context7 shows) and the MCP auth spec version claude.ai
  expects.

#### Design (coordinator, wave 3, 2026-11-15)

Grounded on `origin/main` and in current docs before the claim; the library facts (versions,
option names, what claude.ai asks for) are in the wave's library notes
(`reviews/wave3-library-docs.md`, kept beside the review files) and are re-checked by the builder.
Touches was widened: the Worker's entry (`src/index.ts`) and the test config must change.

- **Library.** `@cloudflare/workers-oauth-provider` (1.2.4 on 2026-11-15) with a KV binding
  `OAUTH_KV`. It serves the metadata documents, client registration, the token endpoint and
  PKCE; this slice writes the authorize page, the owner check and the wiring.
- **Entry.** The default export stays a plain object with `fetch` and `scheduled` (Slice 7's
  cron); `fetch` hands the request to the provider. `/mcp` is the provider's API route and runs
  the existing MCP handler; every other path goes to the existing router unchanged.
- **Bearer tokens keep working** through the provider's external-token hook: a token that is
  not an OAuth token is checked exactly as today (`src/api/auth.ts`) and gets its scope. A
  request with no valid token gets the 401 that points at the resource metadata, which is what
  claude.ai needs to start the flow.
- **Scope of an OAuth caller: read** (decided here: the board is read-mostly and the *Why* is
  asking what is waiting; a write from claude.ai would need the owner to say so).
  **Superseded by [Slice 16](16-chat-reports.md):** the owner wanted chat use reported, so an
  OAuth caller gets the write tools except `sync_snapshot`.
- **The one-owner allow rule (decided here, no question to the owner).** The authorize page
  asks for the owner's passphrase and compares it, in constant time, with the Worker secret
  `OWNER_PASSPHRASE`. Why this and not a sign-in with GitHub or Google: that needs an OAuth app
  made under the owner's own login, an outward step nobody can do in an unattended run, and the
  slice says this must not wait for a console setup. The passphrase is private config, generated
  into the secrets store, never in the repo. Without the secret the page refuses everyone
  (fails closed). If the owner prefers an identity sign-in later, it replaces this one check.
- **Limits on the authorize step.** Client registration is open by the spec, so: only the
  redirect addresses of Claude are accepted (claude.ai's callback and Claude Code's loopback
  callback, taken from the library notes; a list in code, extendable from config), the consent
  form is protected against cross-site posts with the library's consent helpers, and the
  passphrase is checked only after the consent request and its cookie have been verified.
  **No lockout (changed after both reviews).** The first design throttled wrong tries in KV.
  Review 1 showed a per-address counter is bypassed by changing address; review 2 showed a
  page-wide counter lets any stranger lock the owner out, and KV cannot count atomically either
  way. One behaviour meets both: guessing is made hopeless by the passphrase itself, so the page
  refuses everyone while `OWNER_PASSPHRASE` is shorter than 32 characters (the setup generates a
  random one), compares in constant time, and counts nothing. No lockout code or KV counter
  remains.
- **What the owner approves.** The consent page shows the client's name and the full address it
  will be sent back to (with the port for a loopback address). Approval always grants `read`,
  whatever scope the client asked for, including none.
- **Origin.** The issuer and resource address come from the request's own origin by default (no
  hostname is in the repo); an optional `public_origin` in the private board config pins them.
- **States.** A wrong passphrase re-shows the form with an error and a fresh consent request; a
  cancelled or expired authorization leaves nothing behind (codes and
  grants live in KV with the library's expiry); a revoked or expired token gets the same 401 as
  no token. The page is one small server-rendered form (strings in one table, no private data,
  no third-party requests); the form post answers at once, so it has no loading state.
- **Cloud setup** (approved for this repo in the owner's settings): a KV namespace for
  `OAUTH_KV` and the `OWNER_PASSPHRASE` secret. Like the D1 database, no resource id goes into
  the repo if wrangler can bind the namespace without one; the builder checks that against the
  wrangler docs.

#### Work

- [x] context7 / `library-docs` for the Workers OAuth provider and MCP auth.
- [x] OAuth flow with tests; bearer auth unchanged.
- [x] `docs/clients.md` and README: adding the board to claude.ai.

#### Verification

- Tests green; Claude Code with a bearer token still works.
- From claude.ai mobile, "what's waiting for me?" lists the right items.

*Changed while building:*

- Client-id metadata documents are off (they need a compatibility flag); dynamic client
  registration covers claude.ai.
- A non-POST request to `/mcp` answers 405 before auth, as `routeMcp` in `src/api/router.ts`
  did on `main`.
- A provider is built per request from the request origin (or `public_origin`), and the env is
  copied per request because the library binds its helpers to the first env it sees. Proven only
  in the Vitest Workers pool, not on a deployed Worker.
- The lockout from the design was removed after review (see *Design*): the page refuses everyone
  while `OWNER_PASSPHRASE` is shorter than 32 characters.
- Setup done by the coordinator on 2026-11-15: `OWNER_PASSPHRASE` (48 random characters)
  generated into the secrets store and set as a Worker secret (`wrangler secret list` shows it).
  The KV namespace is not created by hand: the `OAUTH_KV` binding has no id and wrangler
  provisions it on the first deploy.

*From review* (`reviews/pr-42-high.md`, `pr-42-medium.md`, `pr-42-check-medium.md`,
`pr-42-check-2-medium.md`, all read in full):

- Applied: high 1, 2, 3, 4 (explicit client expiry; the library offers no cap), 5, 6, 7, 10;
  medium 1, 2, 3, 4, 8, 9, 10; check 3 and 5 in code; check 1 and 2 as documentation.
- Skipped #8 (`reviews/pr-42-high.md`): "createProvider re-parses BOARD_CONFIG JSON on every request" - a per-request cost, no failure path.
- Skipped #9 (`reviews/pr-42-high.md`): "MCP_PATH, MCP_METHOD and LOOPBACK_HOSTS are redefined in several files instead of imported" - duplicated constants, no failure path.
- Skipped #5 (`reviews/pr-42-medium.md`): "OPTIONS preflight gets no CORS headers" - `main` already answered a non-POST `/mcp` with 405 before auth (`routeMcp` in `src/api/router.ts`); kept, and the claude.ai check will show if claude.ai needs otherwise.
- Skipped #6 (`reviews/pr-42-medium.md`): "A new OAuthProvider is built per request, and BOARD_CONFIG is parsed twice" - a per-request cost, no failure path.
- Skipped #7 (`reviews/pr-42-medium.md`): "LOOPBACK_HOSTS is duplicated in provider.ts and domain/redirect.ts" - duplicated constants, no failure path.
- Skipped #4 (`reviews/pr-42-check-medium.md`): "Malformed public_origin (path, uppercase, :443) falls back silently to request host" - an invalid `public_origin` is logged and the request origin is used, which is the slice's default behaviour.
- Skipped #6 (`reviews/pr-42-check-medium.md`): "Library bearer regex refuses static tokens with commas/whitespace" - the two static tokens are generated by tooling and contain no such characters (checked on 2026-11-15 against both stored values: 64 characters each, standard token characters only).
- Skipped #7 (`reviews/pr-42-check-medium.md`): "oauth_redirect_uris accepts non-https, userinfo, malformed entries unvalidated" - the list is the owner's own private config.
- Skipped #8 (`reviews/pr-42-check-medium.md`): "Passphrase gate is length >= 32 only (32 spaces passes)" - no lockout and a length-only floor are the slice's Design ("No lockout"); the setup generated a random 48-character passphrase.
- Skipped #9 (`reviews/pr-42-check-medium.md`): "BOARD_CONFIG parsed 2-3 times per request" - a per-request cost, no failure path.
- Skipped #1 (`reviews/pr-42-check-2-medium.md`): "OPTIONS /mcp gets 405 without CORS headers" - same as medium 5: 405 before auth is as on `main`.
- Skipped #2 (`reviews/pr-42-check-2-medium.md`): "Unauthenticated GET /mcp gets 405, not 401 plus WWW-Authenticate" - same as medium 5.
- Skipped #3 (`reviews/pr-42-check-2-medium.md`): "Wrong passphrase attempts are not counted or delayed" - no lockout is the slice's Design.
- Skipped #4 (`reviews/pr-42-check-2-medium.md`): "Passphrase gate checks length only" - a length-only floor is the slice's Design; documented.
- Skipped #5 (`reviews/pr-42-check-2-medium.md`): "parseConfig(BOARD_CONFIG) runs two to three times per request" - a per-request cost, no failure path.
- Skipped #6 (`reviews/pr-42-check-2-medium.md`): "LOOPBACK_HOSTS and MCP_PATH/MCP_METHOD duplicated across files" - duplicated constants, no failure path.
- Skipped #7 (`reviews/pr-42-check-2-medium.md`): "Owner-configured oauth_redirect_uris unvalidated" - the list is the owner's own private config.
- Skipped #8 (`reviews/pr-42-check-2-medium.md`): "Static-token resolveExternalToken returns no scopes" - the reviewer marked it unconfirmed; kept as a *Not yet verified* line.
- Skipped #9 (`reviews/pr-42-check-2-medium.md`): "Test named "leaves /mcp to its bearer tokens" no longer exercises the router" - one test's route, no failure path.

*Follow-ups (open, not in this slice):*

- The Worker has no way for the owner to end a grant: the README names the library calls, but no
  route calls them.
- A static bearer token used with `public_origin` set and a different request host is untested
  (check-2 finding 8; also under *Not yet verified*).

#### Not yet verified

The first deploy ran 2026-11-15 (c1cc5de); the open lines below were checked by curl against it, as far as stated.

- ~~wrangler provisions the `OAUTH_KV` namespace on the first `deploy:ci` run.~~ Verified 2026-11-16: `wrangler kv namespace list` shows the OAuth KV namespace (and `POST /oauth/register` answered 201 on 2026-11-15).
- ~~The per-request env copy works on the deployed Worker (proven only in the Vitest Workers pool).~~ Seen 2026-11-15: register, discovery, authorize and token routes answer repeatedly without error. Seen 2026-11-16: the owner completed a full grant (passphrase) from claude.ai.
- ~~claude.ai accepts the connector (registration, the 401 pointer on POST, 405 on GET, consent page, token) and "what's waiting for me?" lists the right items.~~ Seen by the owner 2026-11-16: added the connector in claude.ai, signed in with the passphrase, asked "what's waiting for me on the agent progress board?" in a claude.ai chat and reported "it worked". Still open: the same question from the claude.ai app on a phone (the device was not said).
- A static bearer token with `public_origin` set and a different request host still gets through (check-2 finding 8). Not run 2026-11-15: another Host cannot be sent to the workers.dev address; the bearer works on that host.

*Verified 2026-11-15* (Worker at c1cc5de, by curl): a bearer token works against the deployed `/mcp` (write token tool calls 200, read token `list_open` 200, wrong token 401).
Pieces of the claude.ai check seen by curl, the check itself is still open: 401 without a token carries `WWW-Authenticate` with `resource_metadata`; `GET /mcp` is 405 with `Allow: POST`; both discovery documents are 200 (PKCE S256, `registration_endpoint`); registering with the claude.ai redirect is 201 and a foreign redirect is 400 `invalid_redirect_uri`; `GET /authorize` is 200 with the "Connect to the board" page (password field and Allow); a token request with a bogus code is 400 `invalid_grant`. The passphrase POST and a real token were not run (they would leave a grant that cannot be ended). One OAuth client was registered and stays on the live Worker.

#### For CLAUDE.md (lifted 2026-11-15)

- Auth on `/mcp` runs through the OAuth provider in `src/api/oauth`; bearer tokens enter by its
  external-token hook, and OAuth callers are read-only. Never add a second auth path (Slice 5:
  docs/plan/slices/05-remote-mcp.md).
- The default export in `src/index.ts` stays a plain object with `fetch` and `scheduled`
  (Slice 5: docs/plan/slices/05-remote-mcp.md).

#### For README.md

None beyond the diff (the README already carries the claude.ai connector section).
