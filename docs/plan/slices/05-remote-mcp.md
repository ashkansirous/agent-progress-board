### Slice 5 — OAuth so claude.ai can use the MCP server

Source: phone scope (2026-11-15), milestone 5 — see [Slice 1](01-items-api.md). The MCP
endpoint and its tools ship in Slice 1; this slice adds what claude.ai needs.

*In progress (wave 2026-11-15), draft PR.*

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
  form is protected against cross-site posts with the library's consent helpers, and wrong
  passphrases are throttled in KV (5 wrong tries lock the page for 15 minutes).
- **States.** A wrong passphrase re-shows the form with an error and counts a try; a locked
  page says when to retry; a cancelled or expired authorization leaves nothing behind (codes and
  grants live in KV with the library's expiry); a revoked or expired token gets the same 401 as
  no token. The page is one small server-rendered form (strings in one table, no private data,
  no third-party requests); the form post answers at once, so it has no loading state.
- **Cloud setup** (approved for this repo in the owner's settings): a KV namespace for
  `OAUTH_KV` and the `OWNER_PASSPHRASE` secret. Like the D1 database, no resource id goes into
  the repo if wrangler can bind the namespace without one; the builder checks that against the
  wrangler docs.

#### Work

- [ ] context7 / `library-docs` for the Workers OAuth provider and MCP auth.
- [ ] OAuth flow with tests; bearer auth unchanged.
- [ ] `docs/clients.md` and README: adding the board to claude.ai.

#### Verification

- Tests green; Claude Code with a bearer token still works.
- From claude.ai mobile, "what's waiting for me?" lists the right items.
