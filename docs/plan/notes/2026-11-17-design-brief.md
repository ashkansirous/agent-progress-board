# Design brief: a board that explains the work (2026-11-17)

For the owner to paste into Claude Design, in the existing board design project (the one copied
into `docs/design/`). It covers Slices [13](../slices/13-session-cards.md),
[14](../slices/14-checks-in-slice.md) and [15](../slices/15-project-blocks.md). When the mock is
ready, the owner pastes its link back and it is imported into `docs/design/`.

---

**Paste from here:**

Redesign the Agent Progress Board's main page (desktop and phone, dark and light) so the owner can
tell at a glance what is happening in each project, what is left, and what any agent needs from
them, and can open any card for the full story. Keep the existing palette, type scale and tile
style. Use made-up projects ("example-app", "notes-site", "tools") and made-up content.

**1. Project block.** Each project is one block with a header: project name, a one-line summary
("1 needs you · 1 working · 2 planned · 2 problems · 30 checks not tried"), and a control that
folds the whole block. A folded block is just the header. A quiet project (nothing running, nothing
needs you) reads "nothing running · 2 planned" and is folded by default. Show three projects: one
busy, one quiet and folded, one with only a question.

**2. Inside a project, in this order:**

- **Needs you.** The agent's own question in full ("Which iPhone should I read the crash log from:
  the iPhone 8 or the iPad?"), what it will do after the answer ("then I read the log and write the
  cause into Slice 12"), which session asked, and how long it has waited. Most prominent card on the
  page.
- **Working now.** One card per running session or wave: the goal as the title ("Read the crash log
  on the iPhone 8"), what it is for ("for Slice 12: app crashes on start"), the step list with done,
  current and next steps (connect the phone, read the logs, analyse, conclude, plan or fix), the
  current step highlighted, and "last activity 2 min ago". A card with no goal yet reads "Started
  2 min ago, no goal reported yet" in a muted style.
- **Planned.** Each slice as one card: title, status (planned, in progress, parked), a progress bar
  of its parts (A to E, 2 of 5 done), the part being worked on now, and a small count "3 checks not
  tried on a device". No separate cards for parts or checks.
- **Problems and bugs.** Things an agent found broken or blocking: a crash in a released app, a
  failing build, a fix that failed twice. Each card: what is wrong in one line, where it was found,
  and whether a slice is planned for it yet.
- **Done.** Always folded to one line ("12 done in the last 12 hours"); opens on click into a short
  list.

**3. Detail drawer** (opens from any card, a side panel on desktop, full screen on phone): goal
and purpose, what was done so far (a few lines of text), the steps, the slice's parts and its
untested checks as a checklist, links (PR, slice file), and the history in plain words ("started",
"needs you: which iPhone…", "answered", "finished turn", "stale: no activity for 15 min") with times.

**4. States to show:** a stale session (no activity for 15 minutes, greyed, under Done), a project
with only a question, an empty board, loading, and a failed load with Retry.

**5. Phone:** the same blocks stacked; the "Needs you" cards of every project first, above the
projects.

---

**Not in the brief, on purpose:** editing or assigning work from the board (the board stays
read-mostly), the usage page (unchanged).
