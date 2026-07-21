---
id: 001-05
status: done
depends: [001-03]
branch: helm/001-05-refine-chat
gate: { passed: 2026-07-16T21:49:22Z, brief: 62903e5859b28f92, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: 3de7fe77-6b46-486b-b4ad-303960b7fc7f, brief: 1f9cf45ce24b511b, started: 2026-07-17T13:29:12Z, outcome: review, grades: 6/6, tokens: 334504, minutes: 30 }
---
# Refine chat

## Goal

`r` on a Backlog card opens the refine conversation and the brief fills in section by section as
widgets, with open questions as a checklist and weak criteria flagged
(`.knowledge/product/features/define-refine.md` §Refining a story). The brief drawer pane shows
the artifact under construction the whole time.

## Approach

- `r` spawns a `refine` session (Fable, read-only + `update_brief` / `resolve_question`) and
  flips the card `backlog → refining` in the same move (the state machine's entry into refining,
  `.knowledge/product/features/board.md` §Status state machine). The seed is the epic body's
  conclusions (transcripts are not readable), the card, and the canonical brief template
  (goal · approach · blast radius · acceptance criteria · out of scope · open questions,
  `.knowledge/architecture/templates.md`).
- `update_brief` proposes one section at a time; accepting writes that section into the story
  body through the board store, and the artifact pane re-renders from the file, so hand edits and
  chat edits look the same.
- Open questions land in the brief's Open questions section through `update_brief` as plain
  checklist text (the file format stores no options,
  `.knowledge/architecture/board-storage.md` §Story file); the quick-reply options ride the
  session's paired `ask_user` payload and exist only on the widget. `resolve_question` checks
  the item off and folds the answer into the approach on accept.
- Weak-criteria flagging is a UI heuristic on the criteria section (unmeasurable phrasing gets a
  warning marker), deliberate friction before the gate.
- Slash shortcuts (`/split`, `/shrink`, `/risks`, `/estimate`) are canned prompts in the
  composer, available to every chat kind.

## Blast radius

Refine prompt and kind wiring in `src/sessions/`; brief-section and question writes in
`src/board/` (section-targeted body update); `update_brief` / `resolve_question` handling in the
proposal service under `src/server/`; brief artifact pane, `r` key, criteria warnings, and slash
shortcuts in `src/app/`.

## Acceptance criteria

- [ ] `r` on a Backlog card opens a refine chat whose first questions show it read the code, one
      at a time with a recommended answer.
- [ ] An accepted `update_brief` section appears in both the artifact pane and the story file,
      in template order.
- [ ] An open question renders with quick-reply options; answering checks it off and the
      approach section absorbs the answer.
- [ ] A vague criterion ("sync should work well") shows a warning marker; a measurable one does
      not.
- [ ] `/estimate` produces a blast-radius proposal for the section without the user typing a
      prompt.
- [ ] The session resumes by id after an orchestrator restart, and a stale transcript reseeds
      from the card without losing the brief.

## Out of scope

- The ready gate and any status change out of refining (001-06).
- Brief snapshotting for runs (roadmap step 2).

## Open questions

None.
