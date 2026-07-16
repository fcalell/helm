# Roadmap

Forward intent only: the v1 bar (Definition of Done), the ordered next steps, and the post-v1
backlog. For designed behavior, read `features/` + `../architecture/`; shipped work is specced
there, never here.

## v1 Definition of Done

One real story runs end-to-end from the board against a real repo (Sailward is the first target):

- **Shape** a feature in a roadmap chat that proposes epics and draft story cards, accepted onto the
  board ([define-refine](./features/define-refine.md) §Shaping the roadmap).
- **Refine** a story into a brief (goal · approach · acceptance criteria · out of scope · open
  questions) through the proposal-widget chat; the **adversary review** blocks Ready until a cold
  reader finds no critical flaw and the ready gate sees no unresolved question.
- **Run** the story headless in its own git worktree (single run at a time), with the live activity
  timeline streaming in the drawer.
- **Review** against the brief: the criteria checklist leads and the diff supports, the run's test
  results show whether a human verification pass is needed and how to reproduce it; **approve**
  merges to the target's main branch and cleans up the worktree, **request changes** turns comments
  into a follow-up run in the same session.
- Each session kind runs on its configured model and context policy
  ([session-kinds](../architecture/session-kinds.md)).
- The board persists as `.helm/` files and survives an orchestrator restart.

## Next steps (ordered)

1. **Session foundation + shape/define/refine chats**: the session runner, the in-process MCP board
   tools + proposal widgets, and the session-kind registry (model + context policy per kind,
   [session-kinds](../architecture/session-kinds.md)). Brings the shaping surface, the blocking
   adversary gate, the `n` (new story) and `r` (refine) keys, and card creation from the UI (today
   boards are populated by hand-edited files).
2. **Runs + review**: worktree lifecycle, activity timeline, diff view with test evidence, the three
   review exits, and run compaction; brings the live rate-limit meter and queue occupancy (the
   header shows placeholders) and the `r` run key. The command palette (`⌘k`) lands with whichever
   step wants it first.

## v2

- Parallel runs: queue, concurrency cap, rate-limit meter with auto-pause
  ([runs](./features/runs.md)).
- **Needs-input** forms end-to-end (mid-run question → notification → answer resumes).
- Criteria **self-grading** pass before human review ([review](./features/review.md)).
- Notifications: web push (PWA) with ntfy fallback ([mobile](./features/mobile.md)).
- **Guided init**: onboard a repo by exploring it and proposing its `.helm/board/`, agent rules
  (`.helm/agents/`), and knowledge base (`.helm/knowledge/`) from scaffold templates, wired in by one
  import in the repo's root `CLAUDE.md` ([init](./features/init.md)).
- PR mode (approve opens a PR via `gh` instead of merging).
- Mobile PWA surface (built as a stack PWA option) + session-cookie auth + Tailscale deployment
  hardening ([deployment](../architecture/deployment.md)).

## Later

- Dependency-aware queue (story B waits on A).
- An MCP board server, so any external Claude Code session can add/update cards.
- Multi-repo boards.
- **Rules & knowledge library**: curate each managed repo's Helm rules and knowledge docs (all under
  `.helm/`) from a UI surface (view, chat-curate, light edit; [board](./features/board.md) §Screen
  layout), and share best practices across repos. A Helm-owned central library holds the shared rules
  and the generation templates that shape briefs, cards, and reports
  ([templates](../architecture/templates.md)); each repo imports them under `.helm/`, pulled in by the
  repo's `.helm/agents/index.md` (`@import` or symlink, both CLI-native), keeping domain-specific
  rules local. Promoting a repo-local rule to the library applies it everywhere, and reclassifying a
  doc moves it between always-loaded `agents/` and on-demand `knowledge/`. Builds on the CLI's native
  `@`-import (root `CLAUDE.md` → `.helm/agents/index.md` → shared library files), so Helm composes
  rule files rather than injecting prompts. Depends on multi-repo boards; the read-only
  standing-context meter lands earlier with init.
- Run templates (bugfix vs feature presets: permission preset + brief template + review depth).
- Public open-source release (instance-per-user, installed as a global CLI; ships API-key auth,
  the mode Anthropic's ToS requires for distribution, [vision](./vision.md) §Ambition).
