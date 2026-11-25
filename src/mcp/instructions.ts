import { ItemStatus, ItemType } from "../domain/item";
import { SESSION_AGENT, SESSION_STALE_AFTER_MINUTES } from "../domain/stale";
import { StepState, TimeSource, WaitsOn } from "../domain/stepTypes";
import { MAX_OUTCOME } from "../domain/upsert";
import { MAX_STEPS, MAX_STEP_DEPTH, MAX_STEP_ID, MAX_STEP_LABEL, MAX_STEP_NOTE } from "../domain/steps";

/** How often a session reports while working. Must stay below `SESSION_STALE_AFTER_MINUTES` (test/mcpInstructions.test.ts). */
export const HEARTBEAT_MINUTES = 5;

/**
 * Sent to every MCP client in the initialize result, so a connected AI knows how to report.
 * Mirrored between the BEGIN/END RULES markers of `plugin/skills/agent-board/SKILL.md`; change both
 * (test/pluginRules.test.ts holds them equal).
 */
export const SERVER_INSTRUCTIONS = `This server is a progress board. Report your own work on it.

If your brief names a parent card key, you are a helper agent: report your steps on that card and open no session card. Otherwise a card is a task with an outcome; a plain chat, a question answered in the chat and an orchestrator (a wave runner; its slices have their own cards) get none. When you start a task that delivers something (a slice: code merged; refining ideas: a plan), call report_progress once, before the work. For a planned slice's work: key "<project>/slice-<N>", with no type and no agent (the slice's card already exists from the plan sync; the outcome and steps go on it; if the report is refused because no such card exists, report a task card instead). For any other task: key "<project>/task-<id>" (<id> is a short random id, the same for the whole task), type "${ItemType.Unplanned}", agent "${SESSION_AGENT}". Both: project = <project> (the project you work in, or "chats" if none), your environment, status "in_progress", title = the task in one line, outcome = what it delivers (up to ${MAX_OUTCOME} characters, e.g. "Code merged to main"), why = what it is for, steps = your plan as a list of {label, state}, state one of "${StepState.Done}", "${StepState.Active}", "${StepState.Pending}" or "${StepState.Blocked}" (see below). Limits: ${MAX_STEPS} steps in all, ${MAX_STEP_DEPTH} levels, label ${MAX_STEP_LABEL} characters, note ${MAX_STEP_NOTE}; a report over a limit is refused and creates no card.

Keep the card current:
- Steps form a tree: a step may have children, and several steps may be "${StepState.Active}" at once. An optional id keeps a step stable across reports.
- Whenever a step changes, send the whole steps list again; it replaces the stored list, so a list with fewer steps drops the others (a step sent without children keeps its stored ones).
- Give a step that has children or that a helper reports under a short stable id (at most ${MAX_STEP_ID} characters), the same in every report; made-up ids follow the label and change with it.
- A helper sends its own steps with under_step = the id its parent told it; they replace only that step's children. Never send it a flat list.
- While working, report at least every ${HEARTBEAT_MINUTES} minutes (report_progress with the key and status "${ItemStatus.InProgress}"; a session card with no report for ${SESSION_STALE_AFTER_MINUTES} minutes turns stale). If you cannot keep time, report at every step change and before and after a long wait, never on every tool call.
- Work you hand to a background agent keeps its step "${StepState.Active}", with a note naming the agent, until that agent reports back.
- A step that cannot go on is "${StepState.Blocked}": its note (required) says what it waits on; waits_on is "${WaitsOn.Work}" (orange, the default) or "${WaitsOn.Owner}" (red, listed under Needs you); link is an optional http(s) address.
- Send started_at and done_at (ISO, not in the future) when you know them, as in a late or batched report; a time the board stamped itself shows no duration. Only a hook that saw the change sends started_source or done_source "${TimeSource.Observed}", which is never overwritten.
- Call mark_done only when the goal is done and no background agent is still working. Never call it just because a reply ended.
- A question for the person goes in needs_you (and after_answer), on the same card: the question, its options and what each does, the work it belongs to (slice, task) in the title, and a link to where the person acts; never a card that only says "waiting". While it is open, repeat the same needs_you text in every report, heartbeats included (an unchanged text keeps its first-asked time; a report without it can clear the question). When it is answered, send needs_you null. A chat that cannot use report_progress asks with ask_human, giving needs_you (the question) and links on its own waiting_for_me item. A chat that is waiting on the person sends no heartbeat; its card turns stale after ${SESSION_STALE_AFTER_MINUTES} minutes, and that is expected.
- Never guess token numbers; report usage only if you can read it.`;
