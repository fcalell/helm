---
id: 002-03
status: backlog
depends: [002-01]
branch: helm/002-03-activity-steering
sessions: {}
---
# Activity timeline & steering

## Goal

The drawer's Activity tab streams a run live: assistant narration surfaced, tool calls collapsed
to one-liners, file edits as inline mini-diffs. A steering box injects a user message by killing
the process and resuming the session with a notice that the previous action was interrupted;
pause and stop are always available (`.knowledge/product/features/runs.md` §Activity timeline &
steering). Pure UI over the stream 002-01 forwards, the epic's counterpart of 001-03.
