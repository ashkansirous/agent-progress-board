### Slice 2 — Tile board page

Source: phone scope (2026-11-15), milestone 2 — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `web/**`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `src/api/**`,
`e2e/**`, `playwright.config.ts`, `config/board.example.json`, `README.md`

#### Why

The owner opens one URL on their phone and sees (1) what waits for them, (2) what's in flight
per project and what it belongs to, (3) what finished in the last 12h, without opening GitHub,
plan files or transcripts.

#### Decisions

- React + TypeScript (Vite) served as the Worker's static assets; `App.tsx` is a thin shell.
- One group per project; inside each, one tile per item: colour by type, a priority badge, a
  one-line title, a one-line why and the parent. `waiting_for_me` tiles sort first, in their
  own row at the top of each project and in a global "Waiting for you" strip at the top.
- Tap opens a detail drawer: `details_md` rendered (sanitised), links, the event history.
- Colours and type labels come from config, not code; colour is never the only signal (the
  type label is on the tile too).
- The page reads with the read token from the Worker side; the page itself is behind
  Cloudflare Access (one-time PIN or the owner's identity provider). The browser never holds
  the write token.
- Phone first: one column under 600 px, readable at 360 px wide, dark and light themes.
- Any wait over 500 ms shows a loading state; an empty board says so; a failed load says what
  failed and offers Retry.
- Auto-refresh every 60 s while the tab is visible.

#### Work

- [ ] Query context7 for the Cloudflare Vite plugin / Workers static assets setup, Cloudflare
      Access in front of a Worker, and a markdown renderer with sanitising.
- [ ] Board page: project groups, tiles, the waiting strip, the detail drawer.
- [ ] `GET /api/board` for the page (Access-authenticated, reads through the same list
      function as Slice 1).
- [ ] Put the page behind Cloudflare Access (by API with a token from the secrets store).
- [ ] Seed script with two made-up projects covering every type and status.
- [ ] Playwright E2E at a 390×844 viewport and at desktop width: groups, ordering, drawer,
      empty and error states.

#### Verification

- Lint, typecheck, unit and E2E tests green.
- Seeded data from two projects shows correctly on the owner's phone (opened from the
  deployed URL through Access), including the drawer and the waiting strip.
- Opening the page without passing Access is refused.
