---
sessions: {}
---
# Gate convergence

## Goal

A ready gate that fails to converge says so, cheaply, instead of burning attempts in silence.
The 004 loop's second story took 21 adversary rounds because the gate treats every re-requested
attempt as the first, the resumed refine session defends its own transcript, and each accepted
fix re-buys a full cold pass; the loop ended only when a human cut the story's scope by hand.
Source: [loop-findings](../../../research/loop-findings.md) §004 loop, with the 002-01 cost
analysis and the 002-02 warm-middle measurement as the earlier evidence.

## Breakdown rationale

Seven stories. The enabling ones land first, then the small spec-aligned pieces, then the
design-heavy ones whose value they may erase:

0. **Harness drives flagged gate rounds** commits the verification harness in two halves — a stub
   standing in for `claude` that calls the MCP board tools, and an episode driver playing the
   user's beats over the orchestrator API — so a flagged round, a contested flag and an exhausted
   attempt become reachable at zero pool cost. Split out while refining story 1, whose live
   criteria kept collapsing into "graded by reading" for want of it: the loop's most expensive
   machinery was also its least verifiable.
1. **Gate round history** persists every adversary round — its number, flag titles and
   resolutions — into the story's `gate` block as it is spent, and the drawer and card face read
   the count from the file rather than from memory. The record is the unit that is actually
   bought, and it clears at all three exits, including the move out of refining that is what a
   human re-shape looks like from the outside.
2. **One refine turn per story** enforces, where every refine spawn already passes, the invariant
   that today holds only because a story carries a single refine session id — and adds the stub
   step that lets an episode hold a turn open, without which the guard ships graded by reading.
   Split out of story 3 at its third gate round, when three of seven flags landed on the guard
   rather than on the reseed.
3. **Reseed refine on retry** starts a fresh refine session when the user re-requests an
   exhausted gate, seeded from the brief, the open questions, and the override register instead
   of the resumed transcript. Files as truth: a decision that survives only in chat history was
   never durable. It needs a second refine id on one story, which is why the guard lands first.
4. **Delta rounds** is the conditional one: intermediate fix-verify passes that read the prior
   flags plus the brief diff, with the sign-off always a full cold pass. Its value concentrates
   in exactly the non-converging gates stories 1 and 3 aim to prevent, and 002-02 measured the
   warm variant saving almost nothing on a healthy gate, so it waits for post-005 round counts
   before it builds.

5. **Gate escalation** acts on that record: past a five-round budget the drawer names the count,
   shows what the rounds keep flagging (a cheap `digest` session's read of them) and recommends
   splitting or shrinking the story. It never offers a force-through, because dismissal already
   exists and an exhaustion-driven override register defeats the gate. Split out of story 1 at
   its fourth gate round, when the record's semantics and the escalation's kept colliding in one
   brief — the epic's own thesis, applied to itself.

6. **Deterministic episodes** repairs story 0's own instrument: `one-flag` and `exhausted` each
   fail at roughly 50% in isolation, at the same rate before and after 005-06, so the suite
   reports a false failure about a third of the time. Numbered last, built early: every remaining
   story here grades its live criteria against this harness, and 005-06's review already had to
   run each new episode in isolation to tell a real failure from the noise.

Model tiering for late rounds was considered and rejected: spurious flags from a weaker
adversary cost full refine round trips, and 004-02's late rounds raised genuine accepted flaws
([loop-findings](../../../research/loop-findings.md) §004 loop).
