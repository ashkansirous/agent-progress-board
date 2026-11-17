# Report from Claude Code cloud sessions

Written for a Claude Code with no context. A person wants Claude Code cloud sessions (and cloud scheduled tasks,
formerly called routines) to report their token usage to their agent progress board, under a label such as `cloud`.
This guide installs the usage script only: cloud sessions get no cards, no waiting or done marks and no reporting
rules, because those pieces are not installed there.
Name the main machine first (the `environment` option, see [connect.md](connect.md)): once any machine is named, usage
rows with no label join the board's base environment (the busiest named one), so an unnamed main machine would
otherwise be shown mixed into `cloud`.
[connect.md](connect.md) does this for a machine you can install a plugin on; a cloud session cannot use it.

Read from the Claude Code docs on 2026-11-17 (they change; re-read the pages before relying on a detail):
[cloud environments](https://code.claude.com/docs/en/cloud-environments),
[scheduled tasks](https://code.claude.com/docs/en/routines). What the docs do not say is marked **untried** below.

## Why a cloud session reports nothing by default

- Plugins and marketplaces declared in a repo's `.claude/settings.json` (`enabledPlugins`, `extraKnownMarketplaces`)
  are not installed in a cloud session, and plugins enabled only in the user's settings are not either. The board's
  plugin therefore never loads there.
- Hooks in the person's user-level `~/.claude/settings.json` do not run. Hooks in the repo's `.claude/settings.json`
  do (a session with one repository).
- A cloud environment starts with limited network access, so the board host is blocked until listed.

So the cloud route is: the board's reporting scripts on the VM, a hook in the repo's settings that runs them, and
three values in the environment. The scripts read plain environment variables, so no plugin is needed.

## Step 1 (the person): the environment dialog

At [claude.ai/code](https://claude.ai/code), on the new-session screen select the first control in the row under the
message box, then **New environment** (or hover an existing environment's row under **Cloud** and select the
settings icon on its right). A scheduled task picks its environment in the task's **Cloud environment** field, and
shares the environments listed there. Fill in these rows, then select **Add environment** (new) or **Save changes**:

- **Network access**: select **Limited**, keep **Allow package managers** checked, and in **Allowed domains** list the
  board host, one per line (no scheme, no path; `*.` matches every subdomain). The board host is the address's host
  name, which the person knows; never guess it. Without it every report fails and a fail-open client says nothing.
- **Environment variables** (`KEY=value`, one per line):
  `AGENT_BOARD_URL=<board address, https, no trailing slash, ending before /mcp>` and
  `AGENT_BOARD_ENV=cloud` (the label on the usage page; 1 to 40 characters, a longer one is cut to 40; use a
  different label for each environment you want told apart).
- **The write token.** The docs offer two stores. **Environment variables** are readable by anyone who uses the
  environment, so a token there is exposed to them: use a dedicated write token that can be rotated, and add
  `AGENT_BOARD_TOKEN=<token>`. **Network secrets** (the dialog's **Network secrets** row, **Add secret**) keep the
  value unreadable and out of the session's environment variables and files, and the proxy attaches it only as a
  request header to the **Allowed websites** you list. Because it never appears as a variable, the reporting scripts
  cannot read it from there (**untried**: whether the proxy adds an `Authorization: Bearer` header to the scripts'
  calls to the board; the scripts send their own header from `AGENT_BOARD_TOKEN`). Until that is tried with a real
  session, use the plain variable with a rotatable token. Tell the person which they got and why.

## Step 2 (you, in the repo the cloud session works on): setup script and hook

The reporting scripts are plain Node files with no dependencies. A cloud session cannot clone another repository
that is not attached to it (the GitHub proxy refuses it, even a public one), but files committed to a public
repository are reachable at `raw.githubusercontent.com`, which is on the default allowlist while **Allow package
managers** is checked. The environment's **Setup script** row takes a Bash script (up to 64 KB, run as root before
Claude Code starts, cached for about a week). The environment's variables are, per the docs, not set while it runs
(**untried** here), so write every value into the script itself. Put this in it, with `<owner>/<repo>` the board's public repository and <ref>
a commit SHA or release tag the person chooses (ask them; never leave it as `main`). The hook runs these files with
the board's write token in its environment, so a branch name would run whatever lands on that branch next; a pinned
ref changes only when the person changes it.

```bash
#!/bin/bash
base="https://raw.githubusercontent.com/<owner>/<repo>/<ref>/plugin/scripts"
dir=/opt/agent-board/scripts
mkdir -p "$dir/hooks"
for f in usage-tick.mjs report-progress.mjs usage-report.mjs cap-reading.mjs hooks/hook-input.mjs; do
  curl -fsSL "$base/$f" -o "$dir/$f" || true
done
exit 0
```

(Scripts exit 0 even when a download fails, as the docs require; a failed download means no usage, never a failed
session.) The result is cached for about a week, so one failed download leaves an empty or partial folder reused
until the cache expires, and a new `<ref>` reaches the environment only then. To force a rebuild, change the script's
text (for example edit a comment line) and save the environment; and check that all five files exist, not just the
folder. Then add this to the repo's `.claude/settings.json`, which a session with one repository reads. It runs the
usage script after tool calls and when a turn ends, and does nothing outside the cloud (`CLAUDE_CODE_REMOTE` is
`true` only there). The exact command string was run locally with the variable set to `true` (runs), `false` and unset
(does nothing), exit code 0 each time; it has not run in a real cloud session (**untried**):

```json
{
  "hooks": {
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "[ \"$CLAUDE_CODE_REMOTE\" != \"true\" ] || node /opt/agent-board/scripts/usage-tick.mjs", "timeout": 5 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "[ \"$CLAUDE_CODE_REMOTE\" != \"true\" ] || node /opt/agent-board/scripts/usage-tick.mjs --force", "timeout": 5 } ] }
    ]
  }
}
```

The Stop hook only starts a detached background send and returns; whether a cloud VM that pauses right after the
turn lets that send finish, so the session's last tokens arrive, is **untried**.

The hook inherits the environment's variables (the docs say commands Claude runs can read them). **Untried**: that
hooks see them too; if a real session shows no report, that is the first thing to check. If the repo's
`.claude/settings.json` already has hooks, add these entries to the same arrays.

A scheduled task (routine) runs in the cloud environment it names and inherits that environment's network policy,
variables and setup script on every run (scheduled tasks docs), so the same environment and repo settings apply.
Whether a task started through the API trigger runs the repo's hooks the same way is **untried**.

## Where the usage comes from

The usage script reads Claude Code's own session records under `~/.claude/projects` (the folder `claudeDirOf` in
`plugin/scripts/usage-tick.mjs` picks: `AGENT_BOARD_CLAUDE_DIR`, then `CLAUDE_CONFIG_DIR`, then the home folder's
`.claude`). The docs show the cloud user's Claude folder as `/root/.claude`, which is the default, and a test with a
cloud-like home folder finds records there. **Untried**: that a real cloud session writes its records in that
folder. If it does not, usage cannot be read there; say so to the person (cloud sessions have no cards either way, see the top). Set
`AGENT_BOARD_CLAUDE_DIR` in the environment variables if the records are elsewhere.

## Check it

Start a session in the environment, let it run a few tool calls and finish a turn, then open the board's usage page:
a row labelled with the `AGENT_BOARD_ENV` value must appear within a few minutes. Nothing there: check, in order, the
**Allowed domains** entry, that all three variables are set, that `/opt/agent-board/scripts` exists (setup script
output), and that the session's records exist under `/root/.claude/projects`. The reporting never blocks or fails the
session; a missing piece is silent. Also check that the main machine was named first (see
[connect.md](connect.md), *Name this machine*): if the cloud label was set while no machine had a name, the usage
sent earlier with no label is shown under the cloud label, so look at the usage page for the main machine's own row.
