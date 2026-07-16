---
sessions: {}
---
# Session foundation & shaping chats

## Goal

A story is shaped, defined, and refined from the board itself: chat sessions run as real headless
`claude` processes, structure arrives through proposal widgets instead of prose parsing, and the
adversary gate blocks Ready. This is roadmap step 1
(`.knowledge/product/roadmap.md` §Next steps); runs and review are step 2.

## Breakdown rationale

Seven stories, ordered so each ends in a demoable state and later stories ride proven
infrastructure:

1. **Session runner** stands alone first because spawning, streaming, resuming, and killing real
   CLI processes is the riskiest code in the milestone and is verifiable with no board tools.
2. **Board tools** put the in-process MCP server on top: tool calls become pending proposals,
   accepting one is the orchestrator write.
3. **Proposal widgets** are the pure-UI slice: the drawer renders the stream, the widgets, and the
   questions the first two stories produce.
4. **Shape & define chats** compose the first three into the two entry points that create cards.
   Define folds in here: same tools as shape, different seed.
5. **Refine chat** builds the brief section-by-section on the same machinery.
6. **Ready gate** adds the serial dispatcher and the cold adversary pass that blocks Ready; it
   needs finished briefs to attack, so it follows refine.
7. **Research decisions** ride the dispatcher the gate built: one more cold kind, and the shaping
   surface is complete.

Shaping context and the decisions behind this slicing:
[session-foundation](../../shaping/session-foundation.md).
