### Slice 23 — Set up your own board: a guide Claude follows

*Planned and accepted with Slice 19 (owner, 2026-11-17; decisions in
[Slice 19](19-plugin-connect.md), decision 1). Starts after Slice 19.* Docs only.

**Touches:** `docs/setup/own-board.md`, `README.md`, `config/**`, `.dev.vars.example`, `docs/plan/slices/23-own-board-guide.md`

**Migrations:** none

#### Work

- [ ] **`docs/setup/own-board.md`, written for a Claude Code with no context**, run in a fork or clone of this repo:
  what the person needs (a Cloudflare account, a GitHub account); `npm ci`; the person's own `wrangler login`
  (their login, with the link); creating the D1 database and putting its id in `wrangler.jsonc`; the Worker
  secrets the code reads (list them from `src/` and `.dev.vars.example` at build time, with how each is generated
  and where to keep it: a password manager or the person's own secrets store, never the repo); the config
  (`BOARD_CONFIG`: projects, item types, colours; from `config/`); Cloudflare Access in front of the page; the
  first deploy through Workers Builds connected to the person's repo (never a deploy from a shell); then the
  connect guide (`docs/setup/connect.md`) with the new address. Each step the person must do in a console names
  the page and what to press. Verify: every secret and binding the code reads appears in the guide (a reviewer
  checks the list against `src/` and `wrangler.jsonc`).
- [ ] **Example config** in `config/` with made-up projects, so a new board starts with a working config.
- [ ] **README** links the guide under "Use it".

#### Not yet verified

- A fresh Claude Code following the guide in a new Cloudflare account ends with a board that shows a test card.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green; links in the guides resolve.
