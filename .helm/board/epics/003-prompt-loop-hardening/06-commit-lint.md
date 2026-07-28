---
id: 003-06
status: backlog
depends: []
sessions: {}
---
# Commit lint at close

## Goal

The review close's check capture also lints the branch's commits against the Conventional Commit
contract (type prefix, header length) and records the result in the check evidence the reviewer
reads. The run prompt keeps one sentence naming the convention; the enumerated types and limits
leave it.
