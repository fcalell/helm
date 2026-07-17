---
id: 002-07
status: backlog
depends: [002-06]
branch: helm/002-07-review-exits
sessions: {}
---
# Review exits

## Goal

The three exits close the loop (`.knowledge/product/features/review.md` §Three exits): **approve**
re-rebases if main moved, merges to main, pushes, deletes the worktree and branch, card to Done;
**request changes** turns the user's comments into the next message in the same session and
worktree, with the follow-up's model and effort routed by what failed
(`.knowledge/architecture/session-kinds.md` §Model per kind), card to Running; **discard** deletes
the worktree and branch, keeps the brief and run history, card to Ready.
