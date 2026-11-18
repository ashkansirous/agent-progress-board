### Slice 40 — The plugin puts background agents into the step tree

*Planned 2026-11-18. The owner's words (2026-11-18): "now it is stuck on record audio for 15 languages. that is a sub
agent having its own tasks and sub agents ... the task should have it's own sub tasks that would expand when I click
on it", and about fixing the plugin's agent steps in the same piece of work: "4- ok".*

Runs after Slice 39 (the tree and `under_step`) and Slice 29 (both edit the same hook files).

*Built 2026-11-18 (wave 2026-11-18), PR #146, not merged. Not yet verified on the owner's machine (see below).*

**Touches:** `plugin/scripts/hooks/background-agents.mjs`, `plugin/scripts/hooks/session-done.mjs`,
`plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/hooks.test.mjs`, `plugin/scripts/report-progress.mjs`,
`plugin/scripts/report-progress.test.mjs`, `docs/clients.md`, `docs/plan/slices/40-agents-in-tree.md`,
`plugin/scripts/hooks/goal-reminder.mjs`, `plugin/hooks/hooks.json` (the last two added while building)

**Migrations:** none

#### Why

`mergeSteps` (`plugin/scripts/hooks/background-agents.mjs:76-90`) appends one flat step per background agent to the
end of the card's list. It labels the step with the agent's description, or with its type ("general-purpose") when
there is none. It marks only the first running agent as active and the others pending. While any agent runs, it marks
the session's own running step as pending. It cuts the list at 30, which drops the newest agents. On the wave card the
owner looked at, steps 7 to 29 came after steps 1 to 6 but ran before them, four rows just said "general-purpose", and
no step was running.

#### Decisions

- Decided by the planning session of 2026-11-18, building on Slice 39:
  - A background agent becomes a child of the step that was running when the agent started. If several steps were
    running, it goes under the newest one; if none was, it goes at the root.
  - Its label is its description. With no description it is "Helper agent: <first words of its prompt>", never the
    bare type.
  - **A background agent is its own child row under the step that was running** (owner, 2026-11-18, overruling the
    first design pass, which had drawn the agent as a note on that step: "Slice 40 stands: a background agent is its
    own child row under the step that was running (label = its description, or "Helper agent: <first words of its
    prompt>"), with its own steps under that row. The canvas now draws it that way (ActiveV3, ActiveV3Dark,
    ActiveV3Phone)."). The rows are drawn by the Slice 39 tree (path number, ring while the agent runs, open box), and
    what the helper reports under it through `under_step` are that row's children.
  - A running agent is `active` (several may be). Starting an agent never changes the session's own steps.
  - The agent's own reports (a helper briefed with the card key and its step id) go under its node through
    `under_step`. The hook never overwrites a subtree that the helper reported.
- Scripts fail open and keep state only in `CLAUDE_PLUGIN_DATA` (root `CLAUDE.md`).

#### Design (ActiveV3 mock, h2 line 49 of `ActiveV3.dc.html`, `ActiveV3Dark.dc.html`, `ActiveV3Phone.dc.html`, added 2026-11-18)

Three frames (light, dark, phone) with one card that shows helper agents; the page values (rows, numbers, ring, open
box) are in Slice 39's Design subsection and are not repeated. Redrawn by the owner on 2026-11-18 (canvas version
`1795013012-daf3`) to follow this slice:
- **Agent with a description** (`CARDS[0]`): under step 3 "Record audio, 15 languages" sits the agent's own row 3.1,
  labelled with its description "Record the audio, three languages at a time", running, with the note
  "Helper agent · model-small". The 15 languages are its children (3.1.1 to 3.1.15), and French (3.1.2) has its own
  three steps (3.1.2.1 to 3.1.2.3).
- **Agent with no description** (`CARDS[1]`): under step 2 "Draft the scope" sits the row "Helper agent: Compare
  sync-first and cache-first for a notes app…" (the start of its prompt), running, the card's only running leaf, so the
  card header shows that label. The sample row's note ("No description given, so the label is the start of its
  prompt") explains the mock, not a string to build.
- The waiting step "Review the diff" keeps the note "Helper agent: reviewer": a step that will start an agent, before
  it runs; the agent row appears only when it starts.
- The note "Helper agent · <model>" on an agent row (the model the agent runs on) is from the mock. The helper
  descriptions, prompts, "model-small" and the language steps are made-up sample data. The fallback's prefix
  "Helper agent: " and the note's "Helper agent" are new strings (English and German).

#### Work

- [x] Replace `mergeSteps` with a placement that records, when an agent starts, the id of the step that was running,
  and writes the agent as that step's child (`background-agents.mjs`, `hook-input.mjs`).
- [x] Apply the label rule (its description; with none, "Helper agent: <first words of its prompt>"), give the agent's
  row the note "Helper agent · <model>" when the model is known, and remove the demotion of the session's running step
  (`background-agents.mjs:77-78`).
- [x] Remove the 30-step slice. The 200-step tree limit of Slice 39 applies; when it is full, drop the oldest
  finished agents first.
- [x] Add `--under-step <id>` to the reporter CLI (`plugin/scripts/report-progress.mjs`), so scripts and helpers can
  report a subtree.
- [x] Update `docs/clients.md`: how a helper reports under its step.

*Changed while building:*
- Agent rows are placed at a new hook event, `SubagentStart` (`plugin/hooks/hooks.json`, handled in
  `plugin/scripts/hooks/session-done.mjs`), not at the first Stop hook that lists the agent: no earlier hook ran at agent
  start, so the running step could already have moved on (review finding, `reviews/pr-146-high.md` #4).
- The agent goes under the running step by id when the report sent one, else by label; the depth is cut so the helper's
  subtree still fits the four levels. The parent placement and the start times are kept in the goal file and merged per
  agent (`mergeParents`), never as a whole map.
- `SubagentStart` hands the helper its card key and its row id `agent-<id>`; a helper reports with `under_step`
  `agent-<id>`. `docs/clients.md` is rewritten for this (it answers `reviews/pr-146-high.md` #5 and #10).
- The goal file keeps the session's own tree. The parent step is sent with its own children plus the agent rows, and a
  step with a running agent is sent `active`.
- Labels are "Helper agent: <start of the prompt>" and the note "Helper agent · <model>"; the model and the prompt come
  from the agent's jsonl (first 64 KB). English only: the plugin has no locale mechanism, so the design's German strings
  are not built here. Every label passes `maskSecrets` before it is cut.
- `STEPS_MAX` is 200 (was 30). `--under-step` in `plugin/scripts/report-progress.mjs` sends nothing without a step list.
- `plugin/scripts/hooks/goal-reminder.mjs` and `plugin/hooks/hooks.json` were added to Touches.

*Checks:* `npm run lint`, `npm run typecheck`, 641 Vitest tests and 366 plugin tests green (run-checks, 22:07Z).

#### Verification

- `npm test`. New tests in `plugin/scripts/hooks/hooks.test.mjs`: an agent started during step 3 lands under step 3;
  two parallel agents are both active; the session's step stays active; no label is "general-purpose"; an agent with a description is its own row labelled by it, and
  one without is labelled "Helper agent: <first words of its prompt>"; a helper's subtree sits under its own row and
  survives the next hook run.
- On the owner's machine after the plugin update: a session that starts two background agents shows both as running
  children of the step that started them.

#### From review

*Read in full: `reviews/pr-146-high.md` (11 findings), `pr-146-medium.md` (8), `pr-146-check-medium.md` (8), `pr-146-check-2-medium.md` (8), `pr-146-check-3-medium.md` (3), `pr-146-check-4-medium.md` (7 follow-ups, no blocking). A finding with no line below had no skip line from the fixers; the fixers' report was not in the brief, so this file says no more per finding than the Fixed lines.*

- Skipped #4 (`reviews/pr-146-medium.md`): "A step with an agent is sent with `children`, replacing non-agent stored children" - the Decision is that helper reports go under the agent's own row via under_step, and SubagentStart gives each helper its row id; only a helper reporting against docs/clients.md lands under the session step.
- Skipped #6 (`reviews/pr-146-medium.md`): "`readHead` reads and parses 64 KB of every listed agent's record on every hook run" - one bounded read per listed agent, no failure path.

- Follow-up (finding 7, `reviews/pr-146-medium.md`): "a first prompt over 64 KB leaves the label "Helper agent"" - rare; `headFacts` in `plugin/scripts/hooks/background-agents.mjs` drops a first record longer than `HEAD_BYTES`; read the first line fully and skip `tool_result` parts if it ever shows.
- Skipped #2 (`reviews/pr-146-check-medium.md`): "A missing meta file counts as background, but SubagentStart can fire before the file is written" - the next hook run reads the meta file again and drops the foreground agent's row. Follow-up: if a foreground flash on the card shows up, clear the row on SubagentStop when no background agent is left.
- Skipped #7 (`reviews/pr-146-check-medium.md`): "STEPS_MAX raised 30 to 200 for flat lists too" - the deployed board takes 200 steps since the step-tree slice (39) merged.
- Skipped #8 (`reviews/pr-146-check-medium.md`): "When an agent ages out, the emptied owner's `children: []` may be skipped if the sig coincides" - low confidence, no failure path shown. Follow-up: include emptied owners in the sig (`emptiedKeys` in `plugin/scripts/hooks/background-agents.mjs`) if a stale agent row stays on the board after it ages out.
- Fixed in the check pass (`reviews/pr-146-check-medium.md`): #3 the agent row sits at level 3 at the deepest, under the level-2 ancestor for a deeper running step. #4 was already covered: `handle` in `goal-reminder.mjs` returns before `recordCard` when the input carries `agent_id`; a test now pins it.
- Skipped #1 (`reviews/pr-146-check-2-medium.md`): "readBackgroundAgents does not filter foreground agents (startCard/startContext do via isForegroundAgent)" - not crash, data loss, security or privacy; foreground detection is by meta requestShape.
- Skipped #3 (`reviews/pr-146-check-2-medium.md`): "fitAgents counts only steps the session sent, not helper-reported subtrees under agent rows" - the limit is counted on what the hook sends; the board refuses an over-limit report rather than corrupting.
- Skipped #4 (`reviews/pr-146-check-2-medium.md`): "startContext tells the helper to report under agent-<id> even when goal.closed or startCard's send failed" - a refused under_step report changes nothing stored.
- Skipped #5 (`reviews/pr-146-check-2-medium.md`): "agentParents never pruned; emptiedKeys grows all session" - bounded by the session's agent count.
- Skipped #7 (`reviews/pr-146-check-2-medium.md`): "Two statements on one line" - style.
- Fixed in the check-3 pass (`reviews/pr-146-check-3-medium.md`): #1 the agent label (description and prompt words) goes through `maskSecrets` before the cut, `agentLabel` in `plugin/scripts/hooks/background-agents.mjs`.
- Skipped #2 (`reviews/pr-146-check-3-medium.md`): "A recorded agent with no files yet shows as an active row for up to PENDING_AGENT_MS" - low; bounded by the 10-minute window. Follow-up: clear the row on SubagentStop if it shows.
- Skipped #3 (`reviews/pr-146-check-3-medium.md`): "A session step marked done is sent as active while an agent runs under it" - low; the step shows active only while its agent runs, which is the earlier fix's intent.
- Skipped #8 (`reviews/pr-146-check-2-medium.md`): "parentsOf comment says values are labels but placeAgents stores addresses" - style.
- Check 4 (`reviews/pr-146-check-4-medium.md`): no blocking findings; its 7 lows are follow-ups, none built:
  - A foreground agent without a meta file keeps an active row up to `PENDING_AGENT_MS`: `knownAgents` in `plugin/scripts/hooks/session-done.mjs` builds the placeholder without checking the stopped list; skip ids that are stopped.
  - The `maskSecrets` mask is a deny-list: free text like "use the credentials alice / s3cretPw" reaches an agent label unmasked (same residual risk as the waiting card).
  - `agentLabel` in `plugin/scripts/hooks/background-agents.mjs` keeps newlines and whitespace runs: collapse them after masking, before the cut.
  - `goal-reminder.mjs` line 70 holds two statements on one line (style).
  - The row id is unquoted in the `--under-step ${row}` command text in `session-done.mjs`; ids come from hook input.
  - `agentParents` and `agentStarts` in `hook-input.mjs` are never pruned.
  - Every hook run re-reads and re-masks every fresh agent file: cache per id and mtime.

#### For CLAUDE.md

- Agent rows and the helper's row id `agent-<id>` come only from the `SubagentStart` hook (`plugin/scripts/hooks/session-done.mjs`); the goal file is merged per agent (`mergeParents`), never a read-modify-write of the whole `agentParents` map; every agent label passes `maskSecrets` before it is cut or sent (Slice 40: docs/plan/slices/40-agents-in-tree.md).

#### Not yet verified

- On the owner's machine, two background agents show as running child rows under the step that started them, and a helper's own steps appear under its row (no device run: plugin hook behaviour needs a real Claude Code session).
