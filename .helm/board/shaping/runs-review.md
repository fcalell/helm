---
sessions: {}
---
# Runs & review

Shaping thread for roadmap milestone 2 ([roadmap](../../../.knowledge/product/roadmap.md) §Next
steps). Hand-authored: the conversation happened in a plain Claude Code session while the epic 1
shaping stories were still landing, so no session id is attached.

## Agreed notes

- The milestone completes the v1 Definition of Done: a Ready story runs headless in its own
  worktree with the live activity timeline, and review grades the result against the brief with
  the three exits. Spec: `.knowledge/product/features/runs.md`, `.knowledge/product/features/review.md`,
  and `.knowledge/architecture/session-kinds.md`.
- Seven vertical slices, each demoable on its own. The `run` kind with the worktree lifecycle is
  the riskiest code and lands first and alone; compaction is the least-verified mechanic in the
  spec and is isolated for its own review cycle; the review stories land last because they consume
  finished runs.
- v1 review spawns no sessions: the criteria checklist renders ungraded, the diff supports, and
  the run's own test output is the evidence. Self-grading, the standards axis, and the `conflict`
  kind are v2 ([roadmap](../../../.knowledge/product/roadmap.md)).
- Epic 1 infrastructure is assumed: the session runner and kind registry (001-01), board tools and
  `ask_user` (001-02), the drawer chat and widgets (001-03), and the serial dispatcher (001-06).
- Stories are implemented interactively in this repo on master, like epic 1. Whether later epic 2
  stories dogfood as Helm runs is decided once 002-01 lands, not assumed.

## Decisions

- [x] **Standards axis in scope?** Deferred to v2 alongside self-grading. The DoD does not require
  it, and v1 review runs no sessions at all; the axis rides the same graded-review machinery when
  that lands. `review.md` and the roadmap now mark it v2.
- [x] **Conflict kind in scope?** Deferred. Rebase-before-review is in (approve merges to main); a
  conflicting rebase parks the card in Blocked with the error for manual resolution. With one
  serial run and Helm the only writer to the target's main, conflicts stay rare in v1. The kind
  stays in the registry as designed intent.
- [x] **Permission-preset surface?** All three presets. Guarded is the default and needs the
  headless permission-prompt plumbing routed to approve/deny buttons on the card; it is the
  supervision the feature is named for, and the first real Sailward run should not require Auto.
- [x] **Needs-input for runs?** Card state plus form now: a run's `ask_user` flips the card to
  Needs input, the quick-reply form renders in the drawer, and the answer resumes the session,
  all riding 001-02/03 machinery. Only the notification leg stays v2.
- [x] **Landing status for these cards?** Backlog drafts: title, goal, and dependencies. The
  briefs come out of the refine chat (001-05) and the ready gate (001-06), the first real use of
  Helm's own loop. Epic 1 hand-authored full briefs only because that tooling did not exist yet.
- [x] **Hotkeys or buttons?** Buttons everywhere: every board action is a visible control, and the
  app-level hotkey layer (`j/k`, `e`, `n`, `r`, the global Enter/Escape) is removed. Each card
  carries one status-driven action button and the header carries the board-level entries; native
  focus activation is the only keyboard behavior left. 001-04/05 land their keys as briefed and
  story 002-08 retrofits, first in execution once epic 1 finishes.
- [x] **Command palette (`⌘k`)?** Dropped from the design with the hotkey removal: a palette is a
  keyboard surface. Re-proposing it later is a new decision.
