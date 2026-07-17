---
id: 002-01
status: backlog
depends: []
branch: helm/002-01-run-worktrees
sessions: {}
---
# Run kind & worktree lifecycle

## Goal

The `run` session kind works end-to-end with the Auto preset: the Run action on a Ready card (the
status-driven card button, 002-08's pattern) creates
the story's worktree and branch (sparse checkout excluding `.helm/board/`,
`.knowledge/architecture/board-storage.md` §Worktrees), spawns the run with the brief snapshotted
(hash recorded on the run's frontmatter entry), commits its work on the branch, reports its
outcome through the Stop-hook backstop, and flips the card to Review or Blocked
(`.knowledge/product/features/runs.md` §Run lifecycle). Demoable headless through the
orchestrator routes, no new UI.
