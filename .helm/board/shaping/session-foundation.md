---
sessions: {}
---
# Session foundation & shaping chats

Shaping thread for roadmap milestone 1 ([roadmap](../../../.knowledge/product/roadmap.md) §Next
steps). Hand-authored: the conversation happened in a plain Claude Code session before the `shape`
kind existed, so no session id is attached.

## Agreed notes

- The milestone delivers the shaping surface end-to-end: session runner, in-process MCP board
  tools, proposal widgets, the shape/define/refine chats, the blocking adversary gate, and
  research-decision dispatch. Spec: `.knowledge/product/features/define-refine.md` and
  `.knowledge/architecture/session-kinds.md`.
- Seven vertical slices, each demoable on its own. Server foundations land before UI, the runner
  (riskiest code) lands first and alone, and the two dispatcher consumers (gate, research) land
  last so they ride infrastructure the earlier stories proved.
- Stories are implemented interactively in this repo on master, not through Helm runs; Helm cannot
  run itself yet. The briefs still follow the full template because they are the compaction-proof
  contract between sessions, and they double as the first real data for the board UI.
- The stream-json spike (`spikes/stream-json/`) is the reference for CLI mechanics; re-verify its
  findings against current docs before building on them
  (`.knowledge/architecture/claude-integration.md`).

## Decisions

- [x] **Runner and MCP server: one story or two?** Two. The runner is demoable alone (spawn,
  stream, resume) and is the riskiest code, so it gets its own review cycle.
- [x] **Where does the define chat land?** Folded into the shape story. Same tools, same widget
  rendering, two entry points; a standalone story would be mostly wiring.
- [x] **Research decisions in milestone scope?** Yes, as the last story. The serial dispatcher
  must exist for the adversary gate anyway; research is one more cold read-only kind on top.
- [x] **Landing status for these briefs?** `refining`. The user reads each brief and flips it to
  `ready` by hand, a manual stand-in for the gate that does not exist yet, so `ready` keeps
  meaning "a second pair of eyes passed it".
