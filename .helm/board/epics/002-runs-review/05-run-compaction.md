---
id: 002-05
status: backlog
depends: [002-01]
branch: helm/002-05-run-compaction
sessions: {}
---
# Run compaction

## Goal

A run that nears its context window survives it: the orchestrator detects the pressure, summarizes
progress, and resumes the session with the summary plus the brief reloaded from the run's
snapshot, so the contract outlives the transcript
(`.knowledge/architecture/claude-integration.md` §Context management). Isolated as its own story
because it is the least-verified mechanic in the spec; re-verify the CLI's current
compaction/resume behavior before building.
