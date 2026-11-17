### Slice 15 — One collapsible block per project, done work always folded

*Planned.* Waits for the Claude Design mock named in the
[design brief](../notes/2026-11-17-design-brief.md), and for part A of
[Slice 13](13-session-cards.md) and [Slice 14](14-checks-in-slice.md) (it shows their groups).

**Touches:** `web/**`, `e2e/**`, `docs/design/**`, `README.md`, `docs/plan/slices/15-project-blocks.md`

**Migrations:** none.

#### Why

The owner, 2026-11-17: "The grouping is also useless. there should be a way to close the board per
project, and the work already done should be collapsed at all time. the idea is to give me more
visibility on what is happening and allowing me to dig in for more information." Read the same day:
the page groups by project with "Waiting for you", "In flight" and "Done" sections, and has no
collapse anywhere (`web/src`).

#### Decisions (owner, 2026-11-17, "agree to all")

- **Each project is one block that can be collapsed**, and the page remembers it per project.
- **A quiet project takes one line**: "nothing running · 2 planned · 1 needs you".
- **Inside a project, in this order:** Needs you (the agent's question and what happens after),
  Working now (goal, steps with the current one marked, last activity), Planned (slices with their
  parts, progress bar and check count), Problems and bugs, Done (always folded, opens on click).
- **Every card opens the full detail** in the drawer: purpose, what was done, steps, history,
  links.
- **The page is designed in Claude Design first**; this slice builds exactly what the mock shows
  (the mock trumps this file where they differ, `docs/design/README.md`).

#### Decided at the desk

- The collapsed state is a per-viewer convenience kept in `localStorage`, read and written inside
  `try`/`catch`; the page renders expanded projects when storage fails. A project with something
  under "Needs you" opens expanded on load whatever was stored, so a question is never hidden.
- The Active work page (`#/active`) stays and shows only "Working now" across projects.
- The phone layout follows the mock's phone artboards; the waiting strip at the top becomes the
  "Needs you" cards of all projects.

#### Work

- [ ] Import the mock (`import-claude-design`) and write a *Design* section here from it.
- [ ] Project block with header (name, summary line, collapse control) and the five groups.
- [ ] Done folded with its count; opens and closes on click.
- [ ] Drawer: purpose, what was done, steps, checks, history, links.
- [ ] Desktop and phone, light and dark, German strings.
- [ ] E2E: collapse remembered across reload; a project with a question opens expanded; done
  folded by default.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- The owner opens the deployed board on the phone and on the desktop and compares it with the mock.
