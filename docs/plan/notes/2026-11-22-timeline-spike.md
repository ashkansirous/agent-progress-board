# Timeline spike (Slice 52): one session's true step timeline

Result: the plugin can rebuild "step, start, end, model, tokens, peak context" from hook stamps plus the transcript. The
kill rule did not fire: every token of the run was placed on a step or in a named "outside any step" bucket.
Slices 53 to 57 can go ahead, with the changes listed at the end.

## What was run

One local headless run (`claude -p`, v2.1.x) in a scratch folder, with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` and a logging
hook passed by `--settings` on `TaskCreated`, `TaskCompleted`, `PostToolUse` (matcher `TaskUpdate`), `SubagentStart`,
`SubagentStop`, `PreCompact`, `PostCompact` and `Stop`. The task was small, not a full slice build: write a tiny
`slugify` module, write its test, run it, then one review subagent. It ran 87 s and logged 15 hook calls. The run
reported nothing to the board. The scratch hook and script were under `tmp/` (git-ignored, not shipped).
Hook docs: https://code.claude.com/docs/en/hooks (context7 `/websites/code_claude`).

## What the hooks gave

- Every hook call carried session id, transcript path and cwd; the script stamped its own clock (no timestamp in the
  input, as the desk check said).
- `TaskCreated` / `TaskCompleted` carry task id and subject. `TaskCreated` for all three tasks fired in the first 2 s,
  so it is not a start: the start is the `PostToolUse` of `TaskUpdate` with `status: in_progress` (task id in
  `tool_input`).
- `TaskCompleted` fires about 0.2 to 1.2 s before the `PostToolUse` of `TaskUpdate(completed)`; use `TaskCompleted` as
  the end, the other as a cross-check.
- `SubagentStop` carries `agent_id` and `agent_transcript_path` (the subagent's own file under a `subagents/` folder);
  `SubagentStart` carries `agent_id` only. Without that path the subagent's tokens cannot be found.
- No compaction happened in a 87 s run (0 `compact_boundary` lines, no `PreCompact`/`PostCompact` calls), so compaction
  attribution stays unproven here (see changes).

## Timeline (times relative to the first hook call)

| Step | Start | End | Models | Requests (of which subagent) | input / cache read / cache create / output | Peak context |
| --- | --- | --- | --- | --- | --- | --- |
| Write slugify module | 6.8 s | 8.7 s | none placed | 0 | 0 | 0 |
| Write its test | 9.6 s | 22.7 s | main model | 1 (0) | 2 / 73,692 / 539 / 1,105 | 74,233 |
| Review pass | 23.7 s | 61.9 s | main model + the subagent's model | 6 (2) | 12 / 356,842 / 67,402 / 1,883 | 78,192 |

Outside any step: 3 requests (2 before the first `in_progress` update, at -5 s and 0 s, planning and creating the
tasks; 1 at 66 s, the closing line). 10 requests in all after merging streamed lines by message id. Peak context is
the largest single request's input + cache read + cache creation, as Decision 2 says.

Findings from the table:

- Tokens place cleanly by request timestamp inside a step window, and a subagent's requests land inside the window of
  the step that waited on it, with their own model (the subagent used a different model from the main thread).
- A window rule puts the request that decided a transition on the step before it: the first step shows 0 requests
  because the request that wrote the module was stamped before its own `in_progress` update. Attribute that request to
  the step it opens (the request whose tool call is the `TaskUpdate`), not by clock alone.
- Windows overlap: the second step's `completed` and the third step's `in_progress` are 0.1 s apart and the work of a
  step often spills past its `TaskUpdate`. Overlap is rare enough that a "last started, still open" rule suffices.

## Against the card (read-only `get_item` on this slice's own card)

Dropped on the board's server clock at arrival, not at the true moment:

- The step "Claim with a draft PR" shows start and done at the same instant, 31 s after the claim PR's creation time.
  Observed end (PR created) is 32 s earlier than the card's stamped end, and the card shows a 0 s step where the
  real one took about half a minute.
- The next step, "Build the slice", starts on the card at that same arrival instant, so it also starts 31 s late.

The spike run's own steps never reached the card, so the comparison is on the claim step. That is one step, a
30-second gap, not the "1 h active, done 45 min ago" case from the desk check, but it is the same mechanism
(server stamp on arrival, Slice 51 fixes the storage side) and the hook stamps would carry the true time.

## Cost of reading the transcript per hook

- Our hook script's own work: 0.1 ms median (0.05 to 0.21 ms) measured inside the script for 15 real calls.
- Process start dominates and the host sets the floor: a bare `node -e 0` took 124 ms at best, 407 ms median and up to
  1,703 ms over 20 tries on this Windows host; the logging hook took 153 to 849 ms per call over 10 tries. The
  Verification line "added time per call under 200 ms" is therefore **met by our code but not by a node process on this
  host** (best case only). It matters little: a hook runs beside the model, but a `Stop` or `PostToolUse` hook
  can be awaited. Mitigation for Slice 53: one tiny hook that only appends the raw input to a file (no transcript
  read), and the transcript read happens in the sender, not in the hook.
- Transcript size: 796 KB for the main session after 87 s (148 lines, mostly attachments and the system prompt), a
  538 KB subagent file. Full read and JSON parse of the main file took 11 ms. Reading it in 15 offset slices (the
  offset-cache shape) cost 12 ms in all and 796 KB of bytes: with an offset cache each hook reads only the bytes added
  since the last call, so the cost is bounded by growth, not by file size.

## Changes Slices 53 to 57 need

1. Slice 53 (capture): stamp in the hook, use `PostToolUse(TaskUpdate in_progress)` as step start and
   `TaskCompleted` as step end, never `TaskCreated`. Keep the hook to an append-only write (no parse of the
   transcript). Task tools exist only with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` on current models, so a session without
   them has no steps: say so in the data (one "whole session" bucket) rather than inventing steps.
2. Slice 53/54 (attribution): merge assistant lines by `message.id` (a request is streamed as several lines; the last
   carries the final usage); read the subagent file from `agent_transcript_path` on `SubagentStop`; place a request on
   the step open at its timestamp, with the transition-request rule above; keep an explicit "outside any step"
   bucket so totals still add up.
3. Compaction: nothing was observed here. Slice 54 must test one forced compaction (`/compact` in a session) before
   claiming before/after context sizes; the size comes from the transcript's last request before the
   `compact_boundary` line and the first after it (`PostCompact` gives a summary text, not a token count).
4. Slice 55 and later: do not promise "hook added time < 200 ms" in a spec; promise "append-only, no transcript read in
   the hook" and measure the sender instead.
5. The card's steps keep the server's arrival stamps until Slice 51 lands; the timeline should send hook times as the
   step times, not rely on the report's arrival.
