---
id: 001-05
status: ready
depends: [001-03]
gate: { passed: 2026-07-16T21:49:22Z, brief: 62903e5859b28f92, overrides: [] }
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
- Refine stamps the story's `size` hint while writing the brief
  (`.knowledge/product/features/define-refine.md` §Refining a story): the session proposes it
  alongside the final section and accept writes it to frontmatter. `trivial` is the only value
  with a consumer (drops the run to medium effort); absent means standard, so a standard story
  stays unstamped. The `size` field lands in the story frontmatter schema here.
- Slash shortcuts (`/split`, `/shrink`, `/risks`, `/estimate`) are canned prompts in the
  composer, available to every chat kind.

## Blast radius

Refine prompt and kind wiring in `src/sessions/`; brief-section and question writes plus the
`size` frontmatter field in `src/board/` (section-targeted body update; `schema.ts` lacks `size`
today); `update_brief` / `resolve_question` handling in the
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
- [ ] Completing a trivial story's brief lands `size: trivial` in its frontmatter; a standard
      story's frontmatter stays unstamped.
- [ ] The session resumes by id after an orchestrator restart, and a stale transcript reseeds
      from the card without losing the brief.

## Out of scope

- The ready gate and any status change out of refining (001-06).
- Brief snapshotting for runs (roadmap step 2).

## Open questions

None.
