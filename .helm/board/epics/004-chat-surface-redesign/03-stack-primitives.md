---
id: 004-03
status: backlog
depends: []
sessions: {}
---
# Stack primitives

## Goal

`@fcalell/plugin-solid-ui` gains the three primitives the redesign consumes, built in the sibling
`../stack` repo under its own rules. A **docked panel**: a layout-region host with a
drag-resizable width, persistence hook, and an explicit chrome slot, so close and expand controls
live in one row instead of colliding. A **`Sheet` chrome opt-out**: `Sheet.Content` hard-appends
an absolutely-positioned close button today, which overlaps any control a consumer puts in the
top-right corner. A **`Prose` component**: markdown-to-HTML rendering with the stack's
typography tokens, safe for streamed assistant text. This story runs outside the Helm loop; the
Helm-side work is only bumping the dependency once the primitives publish.
