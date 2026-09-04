---
id: 002-09
status: refining
depends: [ 002-06 ]
sessions: { refine: 7c60ca9a-e57d-4327-a744-acb18c2caeb6 }
runs: []
---
# Diff fetch failure

## Goal

A review story whose diff cannot be fetched says so. Today `DiffPane`'s resource rejects — a story
in review with no worktree answers `no worktree for story <id>` — and the pane keeps rendering
"loading the diff" forever, so the one surface a reviewer opens first reads as a hang. The
error branch is written (`diff-pane.tsx:193-200` renders an `EmptyState` on `review.error`) but
never reaches the DOM, and the rejection surfaces only as an uncaught console exception.

Found live while grading 004-06 at Helm `b349fbe`: 004-06 sat in review with no run record, the
Diff tab spun indefinitely, and the console carried four `ORPCError: no worktree` exceptions per
open. Out of 004-06's blast radius (widget chrome and tab overflow), so carded rather than folded
in.
