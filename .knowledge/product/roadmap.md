# Roadmap

Forward intent only: the v1 bar (Definition of Done), the ordered next steps, and the post-v1
backlog. For designed behavior, read `features/` + `../architecture/`; shipped work is specced
there, never here.

## v1 Definition of Done

One real story runs end-to-end from the board against a real repo (Sailward is the first target):

- Create an **epic** and chat it into **draft story cards**, accepted onto the board.
- **Refine** a story into a brief (goal · approach · acceptance criteria · out of scope · open
  questions) through the proposal-widget chat; the **ready gate** blocks an incomplete brief.
- **Run** the story headless in its own git worktree (single run at a time), with the live activity
  timeline streaming in the drawer.
- **Review** the diff in the drawer; **approve** merges to the target's main branch and cleans up
  the worktree; **request changes** turns comments into a follow-up run in the same session.
- The board persists as `.helm/` files and survives an orchestrator restart.

## Next steps (ordered)

1. **Orchestrator API + minimal web board**: columns, cards, drawer shell; board watcher events
   pushed over WebSocket. Prerequisite stack work lands first in `../stack`: `plugin-node` and
   the WebSocket surface ([overview](../architecture/overview.md) §Shape).
2. **Define/refine chats**: the in-process MCP board tools + proposal widgets
   ([define-refine](./features/define-refine.md)).
3. **Runs + review**: worktree lifecycle, activity timeline, diff view, the three review exits.

## v2

- Parallel runs: queue, concurrency cap, rate-limit meter with auto-pause
  ([runs](./features/runs.md)).
- **Needs-input** forms end-to-end (mid-run question → notification → answer resumes).
- Criteria **self-grading** pass before human review ([review](./features/review.md)).
- Notifications: web push (PWA) with ntfy fallback ([mobile](./features/mobile.md)).
- PR mode (approve opens a PR via `gh` instead of merging).
- Mobile PWA surface (built as a stack PWA option) + session-cookie auth + Tailscale deployment
  hardening ([deployment](../architecture/deployment.md)).

## Later

- Dependency-aware queue (story B waits on A).
- An MCP board server, so any external Claude Code session can add/update cards.
- Multi-repo boards.
- Run templates (bugfix vs feature presets: permission preset + brief template + review depth).
- Public open-source release (instance-per-user; ships API-key auth, the mode Anthropic's ToS
  requires for distribution, [vision](./vision.md) §Ambition).
