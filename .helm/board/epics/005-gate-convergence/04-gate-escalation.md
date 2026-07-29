---
id: 005-04
status: backlog
depends: [005-01]
sessions: {}
---
# Gate escalation

## Goal

Once a brief has bought five adversary rounds without converging, the gate says so instead of
waiting for the user to notice. It reads the round record 005-01 persists, and past the budget
the drawer names the count, shows what the rounds keep flagging, and recommends re-shaping the
story: split it or shrink it. The escalation points backward only — force-through already exists
as dismissal, and an affordance that invites exhaustion-driven overrides defeats the gate it sits
on. On 004-02 the scope cut that ended a 21-round loop at round 17 was available at round 5
([loop-findings](../../../research/loop-findings.md) §004 loop); this is the thing that would
have said so.

The themes come from a cheap background session (user decision: a `digest` kind on Sonnet, the
one kind whose purpose is to cost little on the loop's dominant expense), and its input is the
open question this story refines against: loop-findings §Cost measured that flag *titles* are new
every round rather than repeated, so the recurring signal lives in the flag detail bodies, which
the live attempt holds in memory (`gate.ts:373-377`) and 005-01's persisted record deliberately
does not. Whether the digest reads the live attempt, whether the record grows detail, and what a
digest sees after a restart are the calls to settle before it builds.
