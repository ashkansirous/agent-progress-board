### Slice 3 — Claude Code reporter (client side)

Source: phone scope (2026-11-15), milestone 3 — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `README.md`

#### Why

Live events make the board move during a coding-agent run instead of only after the next doc
sync.

#### Where it is built

The reporter CLI, the Claude Code hooks (Notification → waiting_for_me, Stop/SubagentStop →
session done) and the skill that reports slice transitions live in the owner's private
Claude Code config repo, planned there as its own slice. This repo only documents the
contract a client follows, so anyone can write one.

#### Decisions

- **Hard constraint: clients fail open** (`CLAUDE.md`, *Reporters fail open*): a timeout of a
  few seconds, errors swallowed, exit 0; a missing URL or token means do nothing.
- Clients read `AGENT_BOARD_URL` and `AGENT_BOARD_TOKEN` from the environment; never a token in
  a repo.
- Keys: `<project>/slice-<N>`, `<project>/slice-<N>/check-<hash>`, `<project>/session-<id>`,
  the same ones doc sync (Slice 4) uses, so a live report and a doc-read slice are one tile.

#### Work

- [ ] README section "Writing a client": env variables, key format, fail-open rule, a minimal
      curl example with a made-up project.

#### Verification

- One real coding-agent run reported by the client shows its slices moving on the board live.
