---
sessions: {}
---
# Chat surface redesign

## Goal

Every conversation in Helm renders through one docked, resizable chat panel and one shared
conversation component. The three copy-pasted drawer shells and the run chat's parallel
implementation collapse into shared surfaces, assistant text renders as markdown, scroll follows
the reader instead of yanking to the bottom, each pending interaction renders exactly once, and
accepting a proposal announces what it changed. Source: the 2026-07-28 first live test of the
loop; triage and decisions in [chat-surface-redesign](../../shaping/chat-surface-redesign.md).

## Breakdown rationale

Eight stories, ordered so the two live defects land first, the stack primitives land before the
Helm surfaces that consume them, and the independent capability slices ride alone:

1. **Drag-move hardening** fixes the first-drag failure: the pre-snapshot window in `moveStory`,
   the bare server errors that surface as untyped 500 toasts, and the gating branch that reads
   as a dead drag.
2. **Pending interaction** removes the double-rendered question and gives `update_brief` the
   serialization `ask_user` already has, closing the brief-pile regression at the tool boundary.
3. **Stack primitives** builds the docked-panel, sheet-chrome, and `Prose` markdown pieces in
   `../stack`, where panel chrome and typography belong. It runs outside the Helm loop: the work
   lands in the sibling repo under its own rules.
4. **Docked chat panel** replaces the three drawer shells with one `ChatDrawer` over the docked
   panel and updates board.md §Screen layout, the spec change the shaping thread decided.
5. **Unified conversation** merges `ActivityPane` into `ChatPane`, adopts `Prose`, and fixes the
   scroll model.
6. **Widget primitives** extracts the five copies of the widget shell and nine of the eyebrow
   label into shared components and puts `AnswerChip` everywhere chips render.
7. **Acceptance feedback** narrates proposal acceptance: a transcript line, a toast when the
   target is off-screen, a highlight on newly arrived cards.
8. **Refine proposes stories** gives the refine kind `propose_stories`, so work arisen mid-refine
   lands as sibling Backlog cards instead of prose.
