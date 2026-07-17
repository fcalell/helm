---
sessions: {}
---
# Runs & review

## Goal

A Ready story runs headless in its own git worktree and comes back reviewable: the activity
timeline streams live, permission prompts and mid-run questions land on the card, and review leads
with the criteria checklist over a rebased diff, exiting through approve, request changes, or
discard. This is roadmap step 2 (`.knowledge/product/roadmap.md` §Next steps) and the last
milestone before the v1 Definition of Done.

## Breakdown rationale

Eight stories, ordered so the riskiest server code lands first and alone, UI slices ride proven
infrastructure, and review consumes finished runs:

1. **Run kind & worktree lifecycle** stands alone first: worktree creation, the brief-snapshot
   spawn, commits, the Stop-hook outcome, and the Review/Blocked transitions are the riskiest code
   in the milestone, demoable headless with the Auto preset only.
2. **Permission presets & needs-input** add the supervision surface on top: Guarded and Manual
   presets, approve/deny buttons on the card, and `ask_user` flipping the card to Needs input with
   a quick-reply form.
3. **Activity timeline & steering** is the pure-UI slice: the drawer's Activity tab renders the
   stream the runner already forwards, plus the steering box, pause, and stop.
4. **Run queue & rate-limit meter** routes runs through the 001-06 dispatcher and replaces the
   header placeholders with the live meter and queue occupancy.
5. **Run compaction** is isolated because it is the least-verified mechanic in the spec
   (`.knowledge/architecture/claude-integration.md` §Context management); it gets its own review
   cycle the way the runner did in epic 1.
6. **Review: rebase, diff & checklist** opens the review surface: rebase on main (a conflict
   parks in Blocked), the per-file diff, the ungraded criteria checklist pinned above, and the
   run's test evidence.
7. **Review exits** close the loop: approve merges and cleans up, request changes resumes the
   same session with effort routed by what failed, discard throws away the attempt and keeps the
   brief.
8. **UI actions & hotkey removal** (002-08) flips the board from keyboard-first to button-first:
   status-driven card actions and header buttons replace every hotkey. Runs first once epic 1
   lands, so it retrofits the `n`/`r` keys 001-04/05 ship and 002-01's Run entry is a button from
   day one.

Shaping context and the decisions behind this slicing:
[runs-review](../../shaping/runs-review.md).
