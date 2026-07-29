---
id: 005-03
status: backlog
depends: [005-01, 005-02]
sessions: {}
---
# Delta rounds

## Goal

Intermediate gate rounds verify fixes instead of re-attacking the whole brief: a delta pass
reads the prior round's flags plus the brief diff and confirms each fix landed, and the pass
that admits a story to Ready is always a full cold read, so the verdict hash keeps certifying "a
cold reader attacked this exact text". The full-pass sign-off is not negotiable: the
cross-section incoherence that dominated 004-02 (a fix in one section contradicting an untouched
one) is invisible in a diff, and the spec's rationale for the cold re-pass, a fix that quietly
narrows scope faces the next cold reader, holds
([define-refine](../../../knowledge/product/features/define-refine.md) §Ready gate).

This story builds only if the post-005-01/02 round counts justify it. 002-02 measured the warm
variant saving one round's difference ($1.12 against a ~$2 cold read) on a gate that converged
anyway, and the 002-05 through 002-08 gates each passed in a single cold pass, so a delta
round's value concentrates in exactly the non-converging gates the attempt-history escalation
and the retry reseed exist to end early ([loop-findings](../../../research/loop-findings.md)
§004 loop). Open question, resolved before any build: across the loops run since 005-01 and
005-02 landed, how many gates spent three or more rounds inside one attempt?
