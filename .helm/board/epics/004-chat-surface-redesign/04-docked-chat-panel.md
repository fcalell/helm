---
id: 004-04
status: backlog
depends: [004-03]
sessions: {}
---
# Docked chat panel

## Goal

One `ChatDrawer` shell hosts every chat surface as a docked layout region beside the board:
drag-resizable, width persisted, open whenever a card or board-level chat is selected, board
columns compressing beside it. It replaces the three copy-pasted `Sheet` shells
(`shaping-drawer.tsx:143-208`, `define-drawer.tsx:23-104`, `card-drawer.tsx:188-303`), each of
which duplicates the expanded signal, header row, and sizing today, and it puts close and expand
in one chrome row so the `ExpandToggle`/close-button overlap becomes unrepresentable. board.md
§Screen layout is updated to describe the docked panel, the spec change decided in
[chat-surface-redesign](../../shaping/chat-surface-redesign.md).
