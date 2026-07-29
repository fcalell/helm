---
id: 005-02
status: backlog
depends: []
sessions: {}
---
# Reseed refine on retry

## Goal

A re-requested gate after exhaustion runs its fix rounds in a fresh refine session seeded from
the story file, replacing the resume of `sessions.refine`. The resumed transcript hurts twice:
its replay re-enters the session on every fix round, so the per-round price grows with the
rounds already spent, and it carries sunk-cost bias, the 004-02 session kept reintroducing the
supersession design its own transcript had argued for even after edit resolutions removed it
([loop-findings](../../../research/loop-findings.md) §004 loop). What broke that loop was a
fresh read of the brief with no chat history. The seed is the durable state: the brief body, the
open questions, and the attempt's override register. Anything that survives only in chat history
was never durable, the files-as-truth rule the board already lives by
([board-storage](../../../knowledge/architecture/board-storage.md)). Within an attempt the
session still resumes; the reseed boundary is the user's retry, where exhaustion has already
proven the current context stuck.
