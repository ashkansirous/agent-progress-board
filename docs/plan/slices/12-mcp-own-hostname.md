### Slice 12 — The MCP endpoint on the board's own hostname

Source: the owner at the desk, 2026-11-16, asking whether the MCP address could sit under the
board's own hostname instead of the Worker's `workers.dev` address. Written by the feedback loop
of 2026-11-16 ([note](../notes/2026-11-16-1402-feedback-loop.md)); the session had answered with
an offer to plan it and did not.

*Dropped by the owner on 2026-11-16 (choice 1 below). Nothing built; the connector keeps the
address it has now.*

**Touches:** not settled; at least `README.md`, `docs/clients.md` and the Access set-up notes in
[Slice 2](02-tile-board.md). Whether any file under `src/**` changes depends on the decision below.

#### Why

Clients and the claude.ai connector use the `workers.dev` address for `/mcp`, and the page uses the
custom hostname. One address for both is easier to remember and to hand out.

#### What stands in the way

- [Slice 2](02-tile-board.md) decided that Access covers the custom hostname only and that agents
  keep calling `/mcp` on `workers.dev`, "so no Bypass rule is needed".
- `/mcp` and the OAuth paths cannot sit behind the Access login: a script and claude.ai cannot
  sign in there. Serving them on the custom hostname needs an Access Bypass policy for those paths.
- `CLAUDE.md` has the rule "No gate bypass". It is about the page's Access check in
  `src/api/access.ts`; a Bypass policy for `/mcp` is a second opening on the same hostname and
  must not weaken the page's check.

#### The owner's decision

- 2026-11-16: the owner answered "no need for the connector address change. it was too much to
  change." Choice 1 stands: the slice is dropped and `/mcp` stays on its current address.

Choices as offered:

1. Keep it as it is: `/mcp` stays on `workers.dev`. Nothing to build; this slice is dropped.
2. Move it: an Access Bypass policy for `/mcp` and the OAuth paths on the custom hostname, the
   bearer token and the OAuth provider stay the only gate there, and clients change their address.

#### Work (only for choice 2, to be designed first)

- [ ] List the exact paths the OAuth provider in `src/api/oauth` serves, from the code.
- [ ] The Access Bypass policy for those paths (the owner's Cloudflare login, or the API if the
      machine's token allows it).
- [ ] A test that the page and `/api/board` on the custom hostname still answer 302 or 403 without
      an Access session.
- [ ] `docs/clients.md` and `README.md` name the new address; the old one keeps working.

#### Verification

- `POST /mcp` on the custom hostname answers 401 without a token and works with one.
- The page on the custom hostname still redirects to the Access login without a session.
- The claude.ai connector works on the new address.
