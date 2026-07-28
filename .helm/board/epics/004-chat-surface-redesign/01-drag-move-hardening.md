---
id: 004-01
status: backlog
depends: []
sessions: {}
---
# Drag-move hardening

## Goal

A drag performed at any moment fails typed and visibly or succeeds, including the first
interaction after page load. Three live paths break that today. `moveStory`
(`src/app/lib/board-store.ts:109-147`) returns silently when `store.stories[id]` is empty and
skips rollback when `lastBoard` is null, both true before the first WS board snapshot lands.
`boardSnapshot()` and `managedRepo()` (`src/server/services/board.ts:20-28`) throw bare `Error`s
that surface as untyped 500 toasts when a request races service start. The gating branch of
`moveStory` fires `api.story.move` with no optimistic write and discards the `{gating: true}`
result, so a first drag into Ready reads as a drag that did nothing until the gate channel
broadcasts.
