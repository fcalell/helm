---
id: 005-06
status: backlog
depends: []
sessions: {}
---
# One refine turn per story

## Goal

A story runs at most one refine turn at a time, enforced where every refine spawn already passes
rather than by the coincidence that keeps it true today. Today the gate's turn and the user's turn
share one session id, so `messageSession`'s `live.has` check (`src/server/services/sessions.ts:186-191`)
serializes them in both orders; the moment a story can carry a second refine id the invariant is
gone, and nothing else replaces it — `known` is never pruned (`:166`) so a superseded id stays
messageable, `resolveAttach` checks only status (`:462-481`), and `contestGateFlag` and
`gateFixProposed` authorize on phase alone (`gate.ts:448-476`, `:502-526`), so a second concurrent
turn could answer the round the first is working. 005-02 needs that second id; this story makes the
invariant real first, so the reseed inherits a guarantee instead of breaking one.

The harness cannot drive any of it today: `stubStepSchema` is exactly `emit`/`call`/`exit`
(`harness/stub-claude/script.ts:6-14`) and every board tool returns immediately, so no episode can
hold a refine turn open at the moment a second spawn arrives. A hold-open step is the other half
of this story — the instrument, without which the guard ships graded by reading.

Split out of 005-02 at its third gate round, when three of that round's seven flags landed on the
guard rather than on the reseed: its release sites, its interaction with `messageSession`'s
double-spawn stale path, and the park it shares with the unmarked path. The epic's own thesis,
applied to itself.
