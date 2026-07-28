---
id: 003-03
status: backlog
depends: ["003-02"]
sessions: {}
---
# Prompt trims

## Goal

Prompts stop restating what code enforces or another prompt already carries. `gateFlagsPrompt`
shrinks to a pointer plus the flag list (its mechanics duplicate REFINE_PROMPT, which is always
present under reseed-on-stale, and the duplicate joins the transcript refine re-reads every
round); `requestChangesPrompt` stops restating RUN_PROMPT's closing contract; consequence clauses
of code-enforced rules (the propose_epics refusal, the unanswered-flag concession) shrink to one
clause; `ask_user`'s end-your-turn instruction keeps the tool result as its one home; and the
three resolution message builders collapse into one with a source parameter.
