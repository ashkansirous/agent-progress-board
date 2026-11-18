### Slice 40 — The plugin puts background agents into the step tree

*Planned 2026-11-18. The owner's words (2026-11-18): "now it is stuck on record audio for 15 languages. that is a sub
agent having its own tasks and sub agents ... the task should have it's own sub tasks that would expand when I click
on it", and about fixing the plugin's agent steps in the same piece of work: "4- ok".*

Runs after Slice 39 (the tree and `under_step`) and Slice 29 (both edit the same hook files).

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
    bare type. (The owner's later words and the mock supersede the first sentence: the text is "Helper agent:
    <description>", see the next bullet. The no-description fallback and "never the bare type" stand.)
  - **A helper agent appears as a sub-step named by its description** (owner, 2026-11-18, after seeing the mock: "helper
    agents appear as sub-steps named by their description, as in ActiveV3 ('Helper agent: audio-recorder')"; mock
    `ActiveV3.dc.html` and its dark and phone twins, h2 line 49 of each, `CARDS[0]`). The rows are drawn by the Slice
    39 tree (path number, ring while the agent runs, open box). In the sample, the step "Record audio, 15 languages"
    has the note "Helper agent: audio-recorder · model-small · three languages at a time" (its parent line then reads
    "3 of 15 sub-steps done · 3 running · Helper agent: audio-recorder · ..."), and the waiting step "Review the diff"
    has the note "Helper agent: reviewer". The mock draws the agent as that text on its step, with the agent's own
    steps (the languages, and French's "Generate the lines", "Check pronunciation", "Save the file") as the children
    below it; it draws no separate row for the agent above them. This slice's rule is therefore: the agent is a
    sub-step, its text is "Helper agent: <description>" (the label rule above, in this form, whether the description is
    short or missing), and what the helper reports under it through `under_step` are its children.
  - A running agent is `active` (several may be). Starting an agent never changes the session's own steps.
  - The agent's own reports (a helper briefed with the card key and its step id) go under its node through
    `under_step`. The hook never overwrites a subtree that the helper reported.
- Scripts fail open and keep state only in `CLAUDE_PLUGIN_DATA` (root `CLAUDE.md`).

#### Design (ActiveV3 mock, h2 line 49 of `ActiveV3.dc.html`, `ActiveV3Dark.dc.html`, `ActiveV3Phone.dc.html`, added 2026-11-18)

Three frames (light, dark, phone) with one card that shows helper agents; the page values (rows, numbers, ring, open
box) are in Slice 39's Design subsection and are not repeated. The mock agrees with the plan that an agent's steps are
children of the step it works on. It differs in the text: the sample draws "Helper agent: audio-recorder · model-small ·
three languages at a time" as the note of "Record audio, 15 languages", and "Helper agent: reviewer" as the note of the
waiting step "Review the diff". The helper names, the model name "model-small" and the language steps are made-up
sample data. No new strings: the text comes from the agent's description.

**Plan changed to match the mock (2026-11-18):**
- The agent's text is "Helper agent: <description>" (mock: the notes above; the owner's words quoted in the label
  bullet). The earlier line "Its label is its description" is superseded (kept above). The no-description fallback
  and "never the bare type" stand, because the mock does not draw them.
- Verification adds: the step text of a running agent starts "Helper agent: " (`hooks.test.mjs`).

#### Work

- [ ] Replace `mergeSteps` with a placement that records, when an agent starts, the id of the step that was running,
  and writes the agent as that step's child (`background-agents.mjs`, `hook-input.mjs`).
- [ ] Apply the label rule ("Helper agent: <description>", as in the mock) and remove the demotion of the session's running step (`background-agents.mjs:77-78`).
- [ ] Remove the 30-step slice. The 200-step tree limit of Slice 39 applies; when it is full, drop the oldest
  finished agents first.
- [ ] Add `--under-step <id>` to the reporter CLI (`plugin/scripts/report-progress.mjs`), so scripts and helpers can
  report a subtree.
- [ ] Update `docs/clients.md`: how a helper reports under its step.

#### Verification

- `npm test`. New tests in `plugin/scripts/hooks/hooks.test.mjs`: an agent started during step 3 lands under step 3;
  two parallel agents are both active; the session's step stays active; no label is "general-purpose"; a running agent's text starts "Helper agent: "; a helper's
  subtree survives the next hook run.
- On the owner's machine after the plugin update: a session that starts two background agents shows both as running
  children of the step that started them.
