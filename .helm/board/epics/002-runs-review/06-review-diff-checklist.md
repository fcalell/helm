---
id: 002-06
status: backlog
depends: [002-01]
branch: helm/002-06-review-diff-checklist
sessions: {}
---
# Review: rebase, diff & checklist

## Goal

A card in Review opens to the checklist-first surface: the story branch is rebased on the
target's main before review opens (a conflict parks the card in Blocked with the error; the
`conflict` kind is v2), the diff renders per-file side-by-side, the brief's acceptance-criteria
checklist is pinned above it ungraded, and the run's test output and human-verification steps are
surfaced (`.knowledge/product/features/review.md`). Self-grading and the standards axis are v2;
no review sessions spawn.
