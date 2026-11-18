import { ItemStatus, ItemType } from "../domain/item";
import { SESSION_AGENT, SESSION_STALE_AFTER_MINUTES } from "../domain/stale";
import { StepState } from "../domain/stepTypes";
import { MAX_STEPS, MAX_STEP_LABEL, MAX_STEP_NOTE } from "../domain/steps";

/** How often a session reports while working. Must stay below `SESSION_STALE_AFTER_MINUTES` (test/mcpInstructions.test.ts). */
export const HEARTBEAT_MINUTES = 5;

/**
 * Sent to every MCP client in the initialize result, so a connected AI knows how to report.
 * Mirrored between the BEGIN/END RULES markers of `plugin/skills/agent-board/SKILL.md`; change both
 * (test/pluginRules.test.ts holds them equal).
 */
export const SERVER_INSTRUCTIONS = `This server is a progress board. Report your own work on it.

If your brief names a parent card key, you are a helper agent: report your steps on that card and open no session card. Otherwise, at the start of every session or chat, before your first answer, call report_progress once with key "<project>/session-<id>" (<project> is the project you work in, or "chats" if none; <id> is a short random id you make up, the same <project> and <id> for the whole session), project = <project>, type "${ItemType.Unplanned}", agent "${SESSION_AGENT}", your environment, status "in_progress", title = your goal in one line, why = what it is for, steps = your plan as a list of {label, state}, state one of "${StepState.Done}", "${StepState.Active}", "${StepState.Pending}", at most one "${StepState.Active}". Limits: ${MAX_STEPS} steps, label ${MAX_STEP_LABEL} characters, note ${MAX_STEP_NOTE}; a report over a limit is refused and creates no card.

Keep the card current:
- Whenever a step changes, send the whole steps list again; it replaces the stored list, so a list with fewer steps drops the others.
- While working, report at least every ${HEARTBEAT_MINUTES} minutes (report_progress with the key and status "${ItemStatus.InProgress}"; a session card with no report for ${SESSION_STALE_AFTER_MINUTES} minutes turns stale). If you cannot keep time, report at every step change and before and after a long wait, never on every tool call.
- Work you hand to a background agent keeps its step "${StepState.Active}", with a note naming the agent, until that agent reports back.
- Call mark_done only when the goal is done and no background agent is still working. Never call it just because a reply ended.
- A question for the person goes in needs_you (and after_answer), on the same card: the question, its options and what each does, the work it belongs to (slice, task) in the title, and a link to where the person acts; never a card that only says "waiting". While it is open, repeat the same needs_you text in every report, heartbeats included (an unchanged text keeps its first-asked time; a report without it can clear the question). When it is answered, send needs_you null. A chat that cannot use report_progress asks with ask_human, giving needs_you (the question) and links on its own waiting_for_me item. A chat that is waiting on the person sends no heartbeat; its card turns stale after ${SESSION_STALE_AFTER_MINUTES} minutes, and that is expected.
- Never guess token numbers; report usage only if you can read it.`;
