---
id: 001-07
status: done
depends: [001-04, 001-06]
gate: { passed: 2026-07-16T21:42:18Z, brief: 829a22652b3c0d80, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: fe4b878b-2321-42c8-8198-390440731b3a, brief: 829a22652b3c0d80, started: 2026-07-17T17:17:54Z, outcome: done, grades: 5/5, tokens: 255128, minutes: 18 }
---
# Research decisions

## Goal

A shaping decision tagged as research resolves itself: instead of grilling the user, the
orchestrator dispatches a cold read-only session that answers the question from the code and
folds the finding back into the shaping thread
(`.knowledge/product/features/define-refine.md` §Human and research decisions). The user answers
only what genuinely needs them.

## Approach

- `raise_decision` already carries the human/research tag (001-04 records it without acting).
  This story makes the research tag enqueue a `research` session (Sonnet, read-only, always cold,
  `.knowledge/architecture/session-kinds.md`) on the 001-06 dispatcher, prompted with the single
  question and the shaping context.
- The session's result text is the finding: the orchestrator checks the decision off in the
  shaping thread's Decisions checklist and folds the finding into the agreed notes, the same
  write an accepted resolution makes. The shape chat picks the resolution up on its next resume.
- Research runs in the background while the shaping conversation continues; several research
  decisions queue serially. A failed session (error result) leaves the decision open and
  surfaces the failure on the checklist item, so the gate on `propose_epics` stays honest.

## Blast radius

Research prompt and kind wiring in `src/sessions/`; dispatch-on-tag and fold-back writes in the
proposal service under `src/server/` plus the shaping-thread writer in `src/board/`; checklist
status rendering (pending / resolved / failed) in `src/app/`. Small: every piece rides 001-04 and
001-06 infrastructure.

## Acceptance criteria

- [ ] A research-tagged decision enqueues a `research` session and never renders as an `ask_user`
      question.
- [ ] The session spawns cold on Sonnet with the read-only allowlist and no board tools beyond it.
- [ ] Its finding checks the decision off and appears in the shaping thread's agreed notes; the
      resumed shape chat cites it.
- [ ] Two research decisions raised together resolve serially through the dispatcher.
- [ ] A failed research session leaves the decision open, shows the failure on the item, and
      `propose_epics` stays locked.

## Out of scope

- Research kind anywhere outside shaping (the registry scopes it to shaping decisions).
- Parallel dispatch and the rate-limit meter (v2, `.knowledge/product/features/runs.md`).

## Open questions

None.
