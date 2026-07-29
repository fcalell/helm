---
id: 004-02
status: done
depends: []
branch: helm/004-02-pending-interaction
gate: { passed: 2026-07-28T20:37:02.945Z, brief: 7d4988a49cc52d30, overrides: [ "Unconditional collapse can hide a pending question no surface renders: The counter-argument holds: ask_user serialization caps the map at one pending question per chat session, run questions never enter the map, the map is in-memory (no restart pile), and the composer defers while a question pends so a reseed cannot orphan one. The hidden state is unreachable.", "The changed-path wake drops reject/edit feedback that today's hold delivers: Moot after the accepted /shrink cut: the wake/refusal machinery this flag targets was removed from the brief; the shipped design is a stateless guard with turn-end and untouched resume paths.", "The refusal map has no owner or write API, and `stop()` does not exist: Moot after the accepted /shrink cut: the wake/refusal machinery this flag targets was removed from the brief; the shipped design is a stateless guard with turn-end and untouched resume paths.", '"Never injected into a flags round" is not what the design guarantees: Moot after the accepted /shrink cut: the wake/refusal machinery this flag targets was removed from the brief; the shipped design is a stateless guard with turn-end and untouched resume paths.', "The guard is scoped per story, but proposal widgets are scoped per session: a stale pending proposal deadlocks the chat with no surface to clear it: Superseded by the user's hand-finalized brief: supersession was removed entirely (total stateless guard, revise via the widget's Edit/Reject), and the orphaned-proposal edge is recorded as an accepted trade-off in the Approach.", "`supersedeBriefProposals` has no already-resolved or in-flight check, so it can clobber a concurrent accept that has already written the file: Superseded by the user's hand-finalized brief: supersession was removed entirely (total stateless guard, revise via the widget's Edit/Reject), and the orphaned-proposal edge is recorded as an accepted trade-off in the Approach.", "The supersession (live) criterion names a rendering the UI does not have: the reject reason is never displayed: Superseded by the user's hand-finalized brief: supersession was removed entirely (total stateless guard, revise via the widget's Edit/Reject), and the orphaned-proposal edge is recorded as an accepted trade-off in the Approach." ] }
sessions: { refine: e4b92511-c879-4826-a19d-16ed16802856 }
runs:
  - { n: 1, session: 0ee69570-5a3f-40fd-822a-6149ade74e37, brief: 7d4988a49cc52d30, started: 2026-07-28T20:38:23.277Z, outcome: review, grades: 4/8, stat: 4 files +49 -26, tokens: 49554, minutes: 2.5 }
---
# Pending interaction

## Goal

A pending `ask_user` question renders exactly once in the chat pane, and a story's refine chat cannot pile up unresolved resolves-less `update_brief` proposals: one brief-section widget at a time, enforced statelessly at the tool boundary. `resolves`-carrying gate fixes bypass the guard (one per flag, under the gate flow's own arbitration). **Accepted cost, stated:** the guard plus turn-end copy makes the refine loop turn-per-section — an edit or rejection resumes the chat with the outcome, but after a plain accept the chat is idle until the user's next message, so filling all six template sections takes a user message per accepted section. That is the deliberate /shrink trade: no wake machinery, the user drives the cadence, and an idle chat is the normal resting state between proposals.

## Approach

Measured facts at `7e2ccaa`:

- `src/app/components/question-widget.tsx:9-50` — `QuestionWidget` renders the full "Awaiting
  answer" card when `question.pending` and `isSuperseded()` is false; answered and superseded
  states already collapse to a one-line `<p>`.
- `src/server/mcp/tools.ts:315-330` — chat-kind `ask_user` refuses a second question via
  `pendingQuestionFor` (`proposals.ts:140-145`); at most one pending question per chat session; its
  refusal copy is inline and instructs turn-end: the precedent for the guard's `err` text.
- `src/app/components/question-group.tsx:17-66` + `chat-pane.tsx:83-85`, `:196` — the group renders
  the pending question actionably in the same scroll container as the anchored widget, so a live
  question shows twice. The composer defers while a question pends (`chat-pane.tsx:135-137`).
- `src/server/services/proposals.ts:76-84` — `contexts` carries each proposal's `attach`, so
  pending proposals are queryable by bound story; "pending" = present in the `proposals` map
  (`:81`). On full resolution an edit or rejection already resumes the session with the composed
  outcome (`:245-251`); a plain accept dispatches nothing and the user's next message continues the
  chat — the normal resting state of every proposal flow today.
- `src/server/mcp/tools.ts:156-176` — the `update_brief` handler validates the payload and
  `resolves` (via `gateFixProposed`) but has no pending-proposal guard; each call records a
  one-item proposal keyed by `items[0].payload.section` (`proposals.ts:694`).
- `src/sessions/kinds.ts:135` — REFINE_BODY says "a text reply to a proposal means revise and
  re-propose", which conflicts with the guard; the line is updated in this story.

Design — deliberately minimal (user decision, /shrink: no wake machinery, no refusal bookkeeping,
no supersession):

1. **Collapse the pending anchored widget unconditionally.** In `QuestionWidget`, render nothing
   when the question is pending and not superseded: the `QuestionGroup` is the single live surface
   (`ask_user`'s own guard holds the map to one pending question per chat session). Keep the
   settled one-liners for scroll-back. No new imports.
2. **One read helper.** Add `pendingBriefProposalFor(storyId)` to `proposals.ts`: every pending
   resolves-less `update_brief` proposal bound to the story, in creation order (`resolves`-carrying
   fixes excluded).
3. **The guard, stateless and total.** In the `update_brief` handler, a resolves-less call while
   `pendingBriefProposalFor(storyId)` is non-empty is refused — same section or not — with an
   inline `err` (the `ask_user` precedent) naming every pending section and instructing: end your
   turn; the pending widget's resolution or the user's next message continues the conversation. A
   `resolves`-carrying call always passes. The revise path is the widget's Edit/Reject, not a
   competing re-proposal, and REFINE_BODY's "text reply means revise and re-propose" line is
   reworded to say exactly that.

Accepted trade-offs (user decision): a refused chat that ended its turn is idle until the user
acts — the normal resting state of a chat. Pending proposals are in-memory and session-scoped; a
proposal orphaned by a chat reseed can park the guard until a restart clears it, accepted because
the same orphan class exists for every proposal tool today and restarts are cheap.

## Blast radius

- `src/app/components/question-widget.tsx` — unconditional collapse of the live pending rendering; no new imports.
- `src/server/services/proposals.ts` — one new export, `pendingBriefProposalFor(storyId)` (a read over the existing `proposals` + `contexts` maps); no lifecycle, map, or resume changes.
- `src/server/mcp/tools.ts` — guard in the `update_brief` handler, plus **branch-scoped** success copy: the resolves-less branch returns its own turn-end message ("end your turn and await the outcome", no "continue"), while the `resolves`-carrying branch keeps the shared `recordedProposal` string — deliberately, because `kinds.ts:143` requires a gate round's fixes to batch in one turn, and `gate.ts:275-279` auto-contests any flag left unanswered at turn end; unconditional turn-end copy would concede flags 2..n of every round through the prompt surface. The shared `recordedProposal` stays untouched for the other three tools.
- `src/sessions/kinds.ts` — the REFINE_BODY revise sentence (`:135`) reworded to the resolves-less rule (revise via the widget's Edit/Reject, tell the user in a short text turn); the gate-round instruction (`:143`) is **not** changed.
- Touched by implication, not by code: the gate's turn-end concession behavior (`gate.ts:275-279`) is why the copy is branch-scoped; the gate service itself is unmodified.
- Untouched: `question-group.tsx`, `chat-pane.tsx`, `proposal-widget.tsx`, `session-store.ts`, `prompts.ts`, schemas, every other tool handler, the gate service, and `resolveProposalItem` (`dispatchResume` call sites byte-identical to `7e2ccaa`).

## Acceptance criteria

- [ ] `question-widget.tsx` renders nothing when the question is pending and not superseded, and keeps the existing `Answered`/`Superseded` one-liners (file)
- [ ] `proposals.ts` exports `pendingBriefProposalFor(storyId)` returning every pending resolves-less `update_brief` proposal bound to that story id via its `contexts` attach — not filtered by session id — in creation order; `resolves`-carrying proposals are excluded (file)
- [ ] The `update_brief` handler in `tools.ts` refuses a resolves-less call while a resolves-less brief proposal for the story pends: an `isError` result naming the pending section(s) and instructing the session to tell the user — in a short text turn before ending — that the pending section is changed via the widget's Edit/Reject, then end its turn; no proactive resume is promised; a `resolves`-carrying call always passes (file)
- [ ] **Success copy is branch-scoped:** on the `parsed.data.resolves === undefined` branch, `update_brief` returns turn-end copy ("end your turn and await the outcome", no "continue" branch); on the `resolves`-carrying branch it returns the shared `recordedProposal` string unchanged — so a gate round's answer-every-flag-in-one-turn instruction (`kinds.ts:143`) still holds and no flag is ever auto-contested by obeying the copy; `recordedProposal` itself and the other three tools are untouched, and the REFINE_BODY revise sentence in `kinds.ts:135` matches the resolves-less rule (file)
- [ ] No refusal map, wake dispatch, or `prompts.ts` change exists: `dispatchResume` call sites and `proposalOutcomePrompt` are byte-identical to `7e2ccaa` (file)
- [ ] In a refine chat, a live question shows one widget: the actionable group above the composer, with no duplicate "Awaiting answer" card in the transcript; after answering, the `Answered: …` one-liner appears in place in scroll-back (live)
- [ ] In a refine chat with one brief proposal pending, asking for another section change produces no second proposal widget — the pending widget with its Accept/Edit/Reject stays the only actionable surface; rejecting or editing that widget resumes the chat with the outcome, while a plain accept leaves the chat idle until the user's next message (expected behavior, not a failure); the model's pointer-to-the-widget reply is best-effort and not graded (live)
- [ ] `pnpm check` passes (command)

## Out of scope

- **The wake/refusal machinery, cut deliberately (/shrink):** no refusal map, no wake dispatch, no `dispatchResume`/`heldResumes` or `prompts.ts` changes, no service-lifecycle additions. A refused chat that ended its turn is idle — the normal resting state of a chat.
- **Supersession, cut deliberately:** a same-section re-proposal is refused like any other while the pending widget stands; the revise path is the widget's Edit/Reject.
- **Composer deferral stays out of scope; the visible-reply instruction is best-effort, with a deterministic backstop:** the refusal copy and the reworded REFINE_BODY line instruct the model to point the user to the pending widget's Edit/Reject in a short text turn before ending — a prompt instruction, not a guarantee. If the model ends its turn silently, the user still sees their own message plus the pending proposal widget, whose Accept/Edit/Reject buttons remain on screen and actionable — the way forward is always rendered, unlike a truly empty pane. No transcript rendering of tool errors and no composer hint are added.
- Serializing any other proposal tool (`propose_epics`, `propose_stories`, `resolve_question`) — the cross-tool revert class exists today and stays conceded.
- `resolves`-carrying gate fixes: never refused, never serialized — same-section coexistence among fixes stays under the gate flow's existing arbitration.
- Changing `QuestionGroup`, the composer-deferral logic, or the superseded-question rules in `session-store.ts`.
- Persisting pending proposals or questions across a restart — they stay in-memory by design; a proposal orphaned by a chat reseed can park the guard until restart (accepted with the story-scoped filter).
- Any change to the gate service, `resolves` validation, or the fix/contest flow.

## Run notes

- Implemented pending-interaction serialization: `QuestionWidget` renders nothing while a question pends (group above the composer is the one live surface); new `pendingBriefProposalFor(storyId)` read in `proposals.ts`; `update_brief` refuses a resolves-less call while a resolves-less brief proposal for the story pends, and returns branch-scoped turn-end copy on that branch only (gate fixes keep `recordedProposal` and bypass the guard, so no flag is auto-contested); REFINE_BODY's revise sentence reworded to the widget Edit/Reject rule. No `dispatchResume`/`prompts.ts`/refusal-map changes. `pnpm check` passes (tsc + biome clean). verify: in a refine chat, ask a question via `ask_user` — one actionable widget above the composer, no duplicate "Awaiting answer" card in the transcript; after answering, the `Answered: …` one-liner appears in place in scroll-back. verify: with one brief proposal pending, ask for another section change — no second proposal widget appears; the pending widget's Accept/Edit/Reject stays the only actionable surface. verify: rejecting or editing that pending widget resumes the chat with the outcome; a plain accept leaves the chat idle until your next message (expected, not a failure). verify: during a ready-gate round, multiple `resolves`-carrying fixes in one turn are all accepted (guard bypassed, no flag auto-contested).
