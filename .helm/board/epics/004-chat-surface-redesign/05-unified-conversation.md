---
id: 004-05
status: backlog
depends: [004-03]
sessions: {}
---
# Unified conversation

## Goal

One `Conversation` component renders every transcript. `ActivityPane`
(`activity-pane.tsx:117-273`) merges into `ChatPane` (`chat-pane.tsx:128-253`) with pluggable
item renderers: chat surfaces render `ToolCallLine`, runs render `ToolActivity`/`MiniDiff`, and
`compact` items are handled in one place instead of only in the run copy. Assistant text renders
through the stack's `Prose` markdown component instead of raw `whitespace-pre-wrap`. The scroll
model follows the reader: sending anchors the user message near the top with the reply streaming
into the space below, a scrolled-up guard stops the unconditional pin-to-bottom
(`chat-pane.tsx:145-157`), and a scroll-to-bottom control appears while unpinned.
