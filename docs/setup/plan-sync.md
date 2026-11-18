# Plan sync: put a repo's plan on the board

Written for a Claude Code with no context. The `agent-board` plugin is already connected to a board ([connect.md](connect.md)).
This page is for one optional part: reading a repo's plan documents and sending them to the board, so each open slice
is one card, its checks and lettered parts sit inside it, and steps only the person can do show as "Waiting on you".
A repo that does not keep its plan in the layout below skips this page: nothing else in the plugin needs it.

## 1. Check the repo qualifies

The repo qualifies only if all of these are true on its `origin/main` (the sync reads that ref, never the working
tree). Check with `git fetch origin` and `git show origin/main:plan.md`.

- `plan.md` at the repo root has a `## Status` heading with a markdown table whose header row has a `Status` column
  and a first column named `#` or `Slice`; one row per **open** slice, the slice number in the first column
  (`| # | Slice | Status | PR | Issue | File |`). Optional `### <Product>` headings under `## Status` group the rows.
  The `File` cell may link the slice file.
- `docs/plan/slices/NN-<name>.md`, one file per slice (optional; read for a park note and for the lettered groups
  in a `Work` section).
- `docs/plan/unverified.md` (optional): `### Slice N: <title>` headings, each followed by one bullet per open check.
- `docs/plan/notes/slices-done.md` (optional): a flat table of finished slices.

No `plan.md`, or no `## Status` table the script recognises: stop. The script itself says so on stderr and sends
nothing, so running it on a repo that does not qualify is harmless.

## 2. Run it

The script is `scripts/sync-docs.mjs` in the plugin folder. It needs the board address and the write token the same way
the plugin's other scripts do (plugin options, else `AGENT_BOARD_URL` and `AGENT_BOARD_TOKEN`). Always preview first:

```
git fetch origin
node <plugin folder>/scripts/sync-docs.mjs --repo <repo folder> --dry-run     # prints the items, sends nothing
node <plugin folder>/scripts/sync-docs.mjs --repo <repo folder>               # sends them
```

Other flags: `--ref origin/main` (default), `--project <slug>` (default: the main checkout's folder name, the same
project name live reports use, so a slice is one card), `--repo-url <https url>` (default: the `origin` remote, for the
slice-file and PR links), `--parked <file>` (optional: a file of lines `- Slice N: <what it waits for>`; it adds no
item, it only prints one stderr line for each slice named there whose row on main is not parked yet), `--root <folder>`
(read a folder instead of a git ref, for tests).

It fails open: no token, no `plan.md`, a timeout or a board error is one stderr line and exit 0. It is idempotent: the
same documents send the same snapshot and change nothing. The snapshot is the repo's whole set: a slice missing from
the table is closed on the board, so always run it after `git fetch origin`, never on a stale ref.

Run it after each merge to `main` (by hand, or from a hook of the person's choosing that runs `git fetch origin`
first); the plugin installs no hook for it.

## 3. What the board gets

- A slice row: `open` for `planned` or anything unknown, `in_progress` for `in progress` or `built`, `blocked` for
  `parked` or `waiting on the user`.
- A `blocked` slice also gets a "Waiting on you" card (`<project>/slice-<N>/waiting`) when its reason needs the
  person. A reason that is only a wait on work shows as a blocked slice with its reason and **no** card: it starts
  with "waits for", "waiting on" or "behind" and names only work, joined by "and" or "then": another slice (also one in
  another repo), an interactive session, a deploy, a merge, CI, or a PR. Any other word keeps the card ("waits for the
  user", "the owner's go", "waits for Slice 6 and the store pick").
- Each bullet under a slice's block in `unverified.md` is a check inside the slice. A bullet that starts `**You:**`
  is a step only the person can do: it becomes a "Waiting on you" card of its own, not a check.
- Lettered groups (`**A. Title**`) in a slice file's Work section are the slice's parts.
- At most 200 items and 1000 items plus parts go in one call; over either nothing is sent (one stderr line).

## 4. Check it worked

The run prints `sync-docs: <project> items=N created=.. updated=.. closed=.. unchanged=..`. Run it again: the second
run must print `created=0 updated=0 closed=0`. If you see only a stderr line, read it: it names what is missing.
