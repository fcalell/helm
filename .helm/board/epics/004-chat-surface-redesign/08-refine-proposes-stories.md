---
id: 004-08
status: backlog
depends: []
sessions: {}
runs: []
---
# Refine proposes stories

## Goal

The refine kind exposes `propose_stories`, so work arisen mid-refine lands as sibling Backlog
cards through the normal accept path instead of dying in prose or bloating the brief's scope.
The tool allowlist changes in `src/sessions/kinds.ts`, the refine prompt states when to reach
for it (out-of-scope work discovered while investigating, never scope the current story can
keep), and session-kinds.md plus define-refine.md record the tool.
