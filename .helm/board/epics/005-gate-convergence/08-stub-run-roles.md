---
id: 005-08
status: backlog
depends: [005-05]
sessions: {}
---
# Stub roles beyond refine and adversary

## Goal

The stub `claude` recognises every session kind an episode needs to drive, not just refine and
adversary. Today `roleOf` reads the role off two tool markers on `--allowedTools`, so a run, review,
shape or research spawn reaches the stub with no role, claims no script, and dies pre-init. Two
stories in a row have had to leave criteria ungraded for it: 003-09's shaping-decision path, which
needs a `shape` session to resume, and 004-05's run timeline, which needs a run transcript to render.

## Approach

The role is derived, not passed: nothing on the command line names the kind, and `argv.ts` infers it
from a marker tool in the allowlist. The question this story answers is whether that inference
extends to the other kinds, or whether the kind should reach the stub some other way. Both the
marker table and the episode fixtures that would use it are in scope.
