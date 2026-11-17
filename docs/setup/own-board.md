# Set up your own board

Written for a Claude Code with no context. A person asked you to help them run their own agent progress board
on their own Cloudflare account. You work in a fork or clone of this repository, which the person owns. Do the
steps in order, stop at the first one that fails and tell the person what failed. Never put a secret, an account
id or a hostname into a file in git: this repository may be public.

Two things only the person can do: sign in to Cloudflare and GitHub with their own login, and press buttons in
the Cloudflare dashboard. Everything else you do yourself. Never run `wrangler deploy` from a shell: the board
deploys only through Workers Builds (step 7).

## What the person needs

- A Cloudflare account (free plan is enough to start): <https://dash.cloudflare.com/sign-up>
- A GitHub account that owns a fork of this repository: <https://github.com/signup>, then fork with the
  Fork button on this repository's page.
- Node.js 22.18.0 or newer (`package.json` `engines`; check with `node --version`) and git on this machine.
- Somewhere to keep secrets: a password manager or their own private secrets store. Never the repository, a
  chat or a note in the repo.

## What the code reads

Every name below is read by the Worker (`src/env.ts`, `src/api/auth.ts`, `src/api/access.ts`, `src/index.ts`,
`wrangler.jsonc`). The guide below sets each one.

**Bindings** (declared in `wrangler.jsonc`, created for you):

| Name | What | How it is created |
| --- | --- | --- |
| `DB` | D1 database `agent-progress-board` | step 3 |
| `OAUTH_KV` | KV namespace for the OAuth sign-in | wrangler creates it on the first deploy |
| `ASSETS` | the built web page | the build |

**Worker secrets** (never in git; write-only once set, so record each when you generate it):

| Name | Needed for | Without it |
| --- | --- | --- |
| `BOARD_WRITE_TOKEN` | coding agents reporting to the board (the write token the connect guide asks for) | no agent can report |
| `BOARD_READ_TOKEN` | read-only clients | read-only clients are refused |
| `OWNER_PASSPHRASE` | the claude.ai sign-in page, at least 32 characters | nobody can authorize claude.ai |
| `ACCESS_TEAM_DOMAIN` | the Cloudflare Access team domain, such as `your-team.cloudflareaccess.com` | the page and its data refuse everyone |
| `ACCESS_AUD` | the AUD tag of the Access application | the page and its data refuse everyone |
| `BOARD_CONFIG` | optional: the board's config as one JSON line (step 5) | built-in defaults, no projects |

There are no plain-text dashboard vars: a pipeline deploy replaces those with the config file's, but never
deletes secrets, which is why everything above is a secret. `.dev.vars.example` lists the same names with made-up
values for local `wrangler dev`.

## 1. Install and sign in

Run `npm ci` in the repository. Then the person signs in to Cloudflare with their own login: run `npx wrangler
login`, which opens a browser page at <https://dash.cloudflare.com/> where the person presses **Allow**. Check
with `npx wrangler whoami` that the account is the right one before going on.

## 2. Pick the board's name

The Worker is named `agent-progress-board` in `wrangler.jsonc`. Keep it. The Worker gets two addresses:

- the `workers.dev` address, `https://agent-progress-board.<their-subdomain>.workers.dev`: agents and the
  claude.ai connector use this one (token and OAuth sign-in, no Access);
- a custom hostname on a domain the person already has on Cloudflare (for example `board.<their-domain>`): the
  person opens the page here, behind Access (step 6). This is the layout the board was built and tested in.
  A board with no custom domain can still report and be read through agents; the page would answer 403 on the
  `workers.dev` address, because nothing there adds the Access token.

Now only choose the custom hostname with the person and write it down for step 6. It is attached to the Worker
in step 8, after the first deploy: the dashboard offers **Add**, **Custom domain** only once the Worker exists.

## 3. Create the D1 database

Run `npx wrangler d1 create agent-progress-board`. When wrangler asks "Would you like Wrangler to add it on your
behalf?" (to write the database into `wrangler.jsonc`), answer **no**. Keep the database name exactly as `wrangler.jsonc` has it
(`database_name`). `wrangler.jsonc` deliberately carries no `database_id`: wrangler resolves the database by
name, on deploy and on `d1 migrations apply`. Do not add an id to the file, and do not commit one (an id is
account data). The build applies the migrations in `migrations/` itself on every deploy (step 7), so do not run
them by hand. Afterwards run `git diff wrangler.jsonc`: it must print nothing. If wrangler wrote a
`database_id` into the file anyway, undo that change before going on.

## 4. Generate and set the secrets

The three random values never reach this conversation, a command line or the shell history (the same rule as
[connect.md](connect.md) step 2), so the person does this part in their own terminal window, in the repository
folder, and you only tell them what to run. For each of `BOARD_WRITE_TOKEN`, `BOARD_READ_TOKEN` and
`OWNER_PASSPHRASE` (three different values):

1. Generate a value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` prints 64
   characters. The person copies it into their password manager or secrets store under the secret's name.
2. Run `npx wrangler secret put <NAME>`. wrangler asks for the value in its own prompt: the person pastes it there
   and presses Enter. They must not type the value into the command itself.

The write token is what they will type into the connect guide in step 10. The two Access secrets and
`BOARD_CONFIG` come in steps 5 and 6.

Set secrets after the first deploy: do step 7 first, then come back and set the secrets here and in steps 5 and 6
before opening the page. If `wrangler secret put` offers to create a new Worker because none exists yet, answer
no and do step 7 first. The Worker's name is the `name` in `wrangler.jsonc` (`agent-progress-board`); the
Workers Builds project in step 7 must use exactly that name, or the secrets sit on a different Worker than the
one the build deploys.

## 5. The config

`config/board.example.json` is a working config with made-up projects (`recipe-box`, `garden-planner`,
`home-lab`), item types, colours and usage settings. Copy it to a file outside the repository (or to `tmp/`,
which git ignores), then edit:

- `projects`: one `{ "id", "label" }` per project the person works on. An item's key starts with its project id.
- `types`, `palettes`, `statuses`, `priorities`, `usage`: optional; leave out what you do not change. Left out,
  `palettes`, `statuses`, `priorities` and `usage` take built-in defaults; `types` takes none.
- `staleAfterMinutes`: how long a live item may be silent before it shows stale; a whole number, at least 60.
- `public_origin`: leave it unset in this layout. When set, every client, bearer tokens included, must use that
  origin and other hostnames answer 401 (`docs/clients.md`), but here agents use the `workers.dev` address and the
  page uses the custom hostname. Setting it to the custom hostname would lock the agents out.
- `oauth_redirect_uris`: optional list of extra OAuth redirect addresses; claude.ai's own are built in.

A Worker secret is limited to 5 KB (Cloudflare Workers limits, "Variable size"; the whole minified example is
5,598 bytes, so it does not fit). Keep only `projects` and `staleAfterMinutes` plus what the person truly
changes: those two alone are about 150 bytes. After minifying, check that the size in bytes is under 5,000.

Set it as one JSON line without putting it on a command line: write the minified config to `tmp/board.min.json`
(`node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))))" <file> > tmp/board.min.json`),
check its size (`node -e "console.log(require('fs').statSync('tmp/board.min.json').size)"`), then run
`npx wrangler secret put BOARD_CONFIG < tmp/board.min.json`. A bad value is logged and the defaults apply, so a
typo never stops reporting; check the board's page after changing it. No project name, hostname or token goes
into the repository: keep the person's real config only as that secret and in their own store.

## 6. Cloudflare Access in front of the page

The page and `/api/board` answer only requests carrying a valid Cloudflare Access token. The person does this in
the dashboard:

1. Open Zero Trust: <https://one.dash.cloudflare.com/>. If asked, pick a team name (this becomes the team
   domain, `<team>.cloudflareaccess.com`) and the free plan.
2. Left menu, **Access controls**, then **Applications** (older layout: Access, Applications). Press **Add an
   application**, choose **Self-hosted**.
3. Application name: anything. Under **Public hostname** (older layout: Application domain) enter the custom
   hostname from step 2, the whole hostname with no path.
4. Add a policy: action **Allow**, include **Emails** and the person's own email address. Save.
5. Open the saved application and copy its **Application Audience (AUD) Tag**.

Then set the two secrets: `npx wrangler secret put ACCESS_TEAM_DOMAIN` (value `<team>.cloudflareaccess.com`)
and `npx wrangler secret put ACCESS_AUD` (the AUD tag); the person types each value at wrangler's prompt. Without both, the page refuses everyone. Access covers the
custom hostname only: `/mcp` there is behind Access too, so agents use the `workers.dev` address, where the
Worker checks their tokens itself.

## 7. First deploy through Workers Builds

Never deploy from a shell. A new account needs a `workers.dev` subdomain before the first deploy: the person opens
<https://dash.cloudflare.com/?to=/:account/workers/subdomain> (Workers & Pages, right side, **Subdomain**), picks a
name and saves; skip this if the page already shows one. Then the person connects their repository once in the
dashboard:

1. Open <https://dash.cloudflare.com/?to=/:account/workers-and-pages> and press **Create application**, then
   **Import a repository** (older layout: **Connect to Git**). Authorize GitHub when asked and pick the fork.
2. Production branch `main`. Build command: empty. Deploy command: `npm run deploy:ci` (it runs `vite build`,
   applies `migrations/` to the remote D1 database, then deploys). Turn preview builds (non-production branch
   builds) off.
3. Press **Save and deploy**. Every later push or merge to `main` deploys the same way.

The first run creates the `OAUTH_KV` namespace and binds it. Open the run's log in the dashboard (Workers &
Pages, the Worker, Deployments) and confirm it ended green. If the D1 migration step fails because the
database is missing, go back to step 3. If it fails with an authentication or permission error (for example on
`d1 migrations apply`), the build token lacks rights: in the dashboard open the Worker, Settings, Build, and
edit the build token (**API token**) so it may edit D1 and Workers KV, or create a new token with those
permissions, then retry the build. Provisioning `OAUTH_KV` on first deploy follows wrangler's resource
provisioning and has not been run end to end for this guide.

## 8. Add the custom domain

Now the Worker exists. The person opens the dashboard: Workers & Pages, the Worker, Settings, Domains & Routes,
**Add**, **Custom domain**, and enters the hostname chosen in step 2 (the same one the Access application in step 6
uses). Wait until the dashboard shows it active.

## 9. Check the board

Open the custom hostname in a browser: Cloudflare Access asks for the person's email, then the page shows an
empty board. If it shows a refusal, the two Access secrets are missing or wrong (step 6). To check the Worker
is up, run `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<workers-dev-address>/mcp`: it should print `401` (the sign-in
challenge), not a connection error or `404`. This shows only that the Worker answers; it does not prove the
secrets or bindings are right. The test card in step 10 is the real proof.

## 10. Connect Claude Code

Follow [connect.md](connect.md) with the board's `workers.dev` address (`https://<address>`, no trailing slash) and the write
token from step 4 (the person types it in themselves, as connect.md says). It ends with a test card on the board. To add the board to claude.ai, see "Adding the board to
claude.ai (OAuth)" in [../clients.md](../clients.md): the passphrase is `OWNER_PASSPHRASE`.

## Rotating and changing

- A secret changes by running `npx wrangler secret put <NAME>` again; it takes effect without a deploy.
- A new migration or code change reaches the board only through a merge to `main`.
- Never copy a real address, token or account id back into the repository, a PR or an issue.
