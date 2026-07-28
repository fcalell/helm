---
id: 003-08
status: backlog
depends: []
sessions: {}
---
# Gate resilience

## Goal

The two live gate defects from `loop-findings.md` are fixed. The first run note no longer stales
the gate verdict: `appendToSection` trims the body while `stripRunNotes` keeps the two-newline
tail before the heading, so `briefHash` moves on the first `update_card` note (reproduced on
current code) and contradicts board-storage's rule that run notes never stale the verdict; the
strip normalizes trailing whitespace on both sides. And a mid-flight brief edit re-queues a fresh
round against the new brief instead of silently destroying the attempt: the stale-verdict path in
`gate.ts` drops every round, the overrides register, and `pendingFixes` through a bare `abort`,
and the aborts that remain log an error instead of vanishing from the UI.
