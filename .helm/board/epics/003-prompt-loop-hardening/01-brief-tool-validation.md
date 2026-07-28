---
id: 003-01
status: backlog
depends: []
sessions: {}
---
# Brief tool validation

## Goal

`update_brief` rejects what the gate would reject, at call time. An unknown `resolves` flag title
returns an `err()` naming the open titles instead of silently dropping the fix (today the flag
then misreports as contested with no counter-argument), and the Acceptance criteria and Open
questions sections validate as `- [ ]` checklists in the payload schema, so a malformed proposal
is one tool retry instead of a `checkReadyGate` refusal or a gate flag.
