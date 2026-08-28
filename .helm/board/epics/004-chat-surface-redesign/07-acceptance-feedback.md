---
id: 004-07
status: backlog
depends: [004-05, 005-08]
sessions: {}
---
# Acceptance feedback

## Goal

Accepting a proposal announces what it changed. Today the only signal is an "Accepted" badge on
the widget item; the board learns of the new files through the filesystem watcher ~350 ms later
and renders the cards silently. Three additions close the loop: a transcript-level line in the
chat naming the outcome ("Created 3 stories in Backlog"), a toast when the target surface is
off-screen, and a brief highlight on cards newly arrived in a board snapshot, which
`applySnapshot` (`board-store.ts:64-87`) can detect by diffing story ids.
