---
id: 003-02
status: done
depends: []
sessions: {}
---
# Prompt composition

## Goal

Every spawnable kind prompt is composed from the six shared blocks the system-prompts plan
designed (READ_ONLY, BOARD_OUTPUT, GRILLING, VERTICAL_SLICE, TOOL_MECHANICS, HEADLESS) through a
compose helper that joins role, body, and blocks in fixed order with the stopping clause last.
`research` stops inlining its own read-only phrasing, HEADLESS leaves RUN_PROMPT for reuse by
`conflict`, blocks stay byte-identical across kinds (the prompt-cache rule, session-kinds.md
§Prompts), and the helper owns the fixed frame the body-only per-repo override will slot into.
