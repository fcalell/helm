---
sessions: {}
---
# Chat surface redesign

Shaping thread for the chat/panel redesign out of the 2026-07-28 first live test of the loop.
Hand-authored: the feedback triage happened in a plain Claude Code session, so no session id is
attached.

## Agreed notes

- The feedback items trace to four structural gaps plus two defects, all mapped against the
  current app. The drawer chrome is copy-pasted three times (`shaping-drawer.tsx`,
  `define-drawer.tsx`, `card-drawer.tsx`) with only `ExpandToggle` shared; the run chat
  (`activity-pane.tsx`) reimplements the message list, scroll effect, and composer wholesale.
- No markdown renderer exists in the app: assistant text renders raw with `whitespace-pre-wrap`.
  Auto-scroll is one unconditional pin-to-bottom effect with no scrolled-up guard.
- A pending question renders twice in the same scroll container: inline via `QuestionWidget`
  ("Awaiting answer") and again via `QuestionGroup` (the actionable chips). Proposals prevent
  exactly this with `unanchoredProposals`; questions have no equivalent filter.
- Proposal acceptance is near-silent: the board learns of new files only through the filesystem
  watcher (~350 ms), cards appear with no announcement, and the only in-chat signal is a badge
  on the widget item.
- The overlay `Sheet` is the wrong host: default width is min(75vw, 576px), "full" is 75vw, the
  stack hard-appends its close button where `ExpandToggle` sits, nothing is resizable, and the
  expanded state resets on close.
- First-drag failures have three live "state not there yet" paths: `moveStory` no-ops or skips
  rollback before the first board snapshot (`board-store.ts`), server lazy singletons throw bare
  errors that surface as untyped 500 toasts (`services/board.ts`), and the gating branch skips
  the optimistic write and ignores `{gating:true}`, reading as a dead drag.
- `update_brief` lacks the serialization `ask_user` just gained (`pendingQuestionFor` in
  `mcp/tools.ts`), so brief sections still arrive in a pile against the spec's one-at-a-time
  rule.
- Refine has no `propose_stories`, so work arisen mid-refine has nowhere to land but prose.
- The two defect fixes ride first and need none of the redesign. Stack primitives precede the
  Helm surfaces that consume them and are built in the sibling `../stack` repo under its own
  rules, never worked around.

## Decisions

- [x] **Overlay sheet or docked panel?** Docked. The chat panel becomes a layout region beside
  the board: drag-resizable, width persisted, open whenever a card or board-level chat is
  selected, board columns compress. Honors board.md's one-screen rule and makes acceptance
  feedback ambient; board.md §Screen layout is updated in the same story.
- [x] **Where do the new primitives live?** In `../stack`: a resizable docked-panel primitive, a
  `Sheet` close-button opt-out, and a `Prose` markdown renderer. Typography and panel chrome are
  stack concerns; Helm consumes them.
- [x] **How is one-at-a-time enforced?** At the tool boundary, mirroring `pendingQuestionFor`: a
  second `update_brief` while one is unresolved is refused. In the UI, one render site per
  pending interaction: the anchored widget collapses while its actionable copy is live.
- [x] **Does refine get `propose_stories`?** Yes. Sibling stories arisen mid-refine land as
  Backlog cards through the accept path; session-kinds.md and define-refine.md record the tool.
