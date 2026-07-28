---
id: 003-05
status: backlog
depends: []
sessions: {}
---
# Denied-call memory

## Goal

The permission path remembers a denied call and auto-denies an exact (tool, input) repeat within
the same segment, without re-prompting the user. Denial finality stops depending on model
discipline: the observed failure mode is verbatim retries, and normalized matching stays out
because it risks auto-denying a call the user would approve.
