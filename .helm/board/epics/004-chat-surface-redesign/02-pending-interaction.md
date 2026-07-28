---
id: 004-02
status: backlog
depends: []
sessions: {}
---
# Pending interaction

## Goal

Each pending interaction renders exactly once, and interactive tools are serialized at the tool
boundary. Today a pending question renders twice in the same scroll container: inline via
`QuestionWidget` as an "Awaiting answer" card, and again via `QuestionGroup` as the actionable
chips; proposals prevent this with `unanchoredProposals` (`session-store.ts:670-685`) and
questions have no equivalent, so the anchored widget must collapse while its actionable copy is
live. And `update_brief` lacks the refusal `ask_user` gained with `pendingQuestionFor`
(`src/server/mcp/tools.ts`): a second proposal while one is unresolved goes through, piling brief
sections against define-refine.md's one-at-a-time rule.
