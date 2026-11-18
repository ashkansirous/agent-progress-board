### Slice 40 — The plugin puts background agents into the step tree

*Planned 2026-11-18. The owner's words (2026-11-18): "now it is stuck on record audio for 15 languages. that is a sub
agent having its own tasks and sub agents ... the task should have it's own sub tasks that would expand when I click
on it", and about fixing the plugin's agent steps in the same piece of work: "4- ok".*

Runs after Slice 39 (the tree and `under_step`) and Slice 29 (both edit the same hook files).

*In progress (wave 2026-11-18), draft PR.*

**Touches:** `plugin/scripts/hooks/background-agents.mjs`, `plugin/scripts/hooks/session-done.mjs`,
`plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/hooks.test.mjs`, `plugin/scripts/report-progress.mjs`,
`plugin/scripts/report-progress.test.mjs`, `docs/clients.md`, `docs/plan/slices/40-agents-in-tree.md`

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

- [ ] Replace `mergeSteps` with a placement that records, when an agent starts, the id of the step that was running,
  and writes the agent as that step's child (`background-agents.mjs`, `hook-input.mjs`).
- [ ] Apply the label rule (its description; with none, "Helper agent: <first words of its prompt>"), give the agent's
  row the note "Helper agent · <model>" when the model is known, and remove the demotion of the session's running step
  (`background-agents.mjs:77-78`).
- [ ] Remove the 30-step slice. The 200-step tree limit of Slice 39 applies; when it is full, drop the oldest
  finished agents first.
- [ ] Add `--under-step <id>` to the reporter CLI (`plugin/scripts/report-progress.mjs`), so scripts and helpers can
  report a subtree.
- [ ] Update `docs/clients.md`: how a helper reports under its step.

#### Verification

- `npm test`. New tests in `plugin/scripts/hooks/hooks.test.mjs`: an agent started during step 3 lands under step 3;
  two parallel agents are both active; the session's step stays active; no label is "general-purpose"; an agent with a description is its own row labelled by it, and
  one without is labelled "Helper agent: <first words of its prompt>"; a helper's subtree sits under its own row and
  survives the next hook run.
- On the owner's machine after the plugin update: a session that starts two background agents shows both as running
  children of the step that started them.
