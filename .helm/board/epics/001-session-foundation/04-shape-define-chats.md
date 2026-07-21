---
id: 001-04
status: done
depends: [001-03]
branch: helm/001-04-shape-define-chats
gate: { passed: 2026-07-16T21:49:22Z, brief: c34780a0bbf2cdaa, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: 544ecea3-0ac7-4ff3-9c4c-aabee52b58d6, brief: c34780a0bbf2cdaa, started: 2026-07-17T12:05:55Z, outcome: review, grades: 5/5, tokens: 490396, minutes: 51 }
---
# Shape & define chats

## Goal

The two card-creating conversations work end-to-end: a board-level **shape** chat turns a rough
feature into epics behind a Decisions checklist, and the **define** chat (`n`) breaks an epic into
draft story cards (`.knowledge/product/features/define-refine.md` §Shaping the roadmap, §Defining
an epic). Define folds in here: same tools and widgets as shape, different entry and seed.

## Approach

- Shape entry from the board header seeds a `shape` session with the user's rough goal; the
  thread persists as `.helm/board/shaping/<slug>.md` (session id + agreed notes + Decisions
  checklist) and resumes by id across visits.
- The Decisions checklist is the shaping drawer's artifact pane: `raise_decision` adds an item
  (its accept write, deferred by 001-02, lands here). Resolution is an orchestrator write, not a
  tool: answering a decision (through its `ask_user` widget or the checklist) checks the item
  off and appends the answer to the agreed notes — the same write 001-07's research fold-back
  reuses. The shape tool set stays closed: agreed notes accumulate only through the thread's
  seed and these resolution appends. `propose_epics` is refused by the orchestrator while a
  decision is open, so a breakdown never outruns the thinking. Human decisions surface through
  `ask_user` grilling; the research tag is recorded but dispatches nothing yet (001-07).
- Accepting a proposed epic writes `NNN-<slug>/epic.md`, minting the next ordinal; a proposal
  carrying draft stories writes them as Backlog cards in the same accept.
- `n` creates the epic and opens a `define` session seeded with title plus rough paragraph;
  `propose_stories` mini-cards land accepted stories in Backlog. For define sessions the
  proposal also carries the epic's goal and breakdown rationale; accept completes the epic body
  alongside the story writes, so an `n`-created epic ends with the same anatomy as a shaped one
  (`.knowledge/architecture/board-storage.md` §Story file). A text reply like "merge 2 and 3"
  resumes the session and triggers a re-proposal.
- Prompts per kind instruct explore-first grilling (one question at a time, recommended answer
  attached), stamped from the generation templates
  (`.knowledge/architecture/templates.md`).

## Blast radius

Prompt templates and kind wiring in `src/sessions/`; `shaping/` support in `src/board/` — the
classifier, loader, and watcher cover `epics/` only today, so this story teaches them shaping
threads (classify, parse, write, session-id frontmatter) — plus the shape-gating rule in the
proposal service under `src/server/`; header entry, `n` key, shaping drawer artifact pane in
`src/app/`. Epic-folder creation and ordinal minting already land in 001-02.

## Acceptance criteria

- [ ] The header entry opens a shaping chat; its thread file appears under
      `.helm/board/shaping/` and reopening the board resumes it with memory.
- [ ] `raise_decision` items render in the Decisions checklist, and `propose_epics` is refused
      while any item is open.
- [ ] Resolving the last open decision unlocks `propose_epics`, and accepting writes the epic
      folder with the next free ordinal.
- [ ] `n` on the board opens a define chat that reads the repo before asking its first question,
      one question at a time with a recommended answer.
- [ ] Accepted draft stories land in Backlog as valid story files the watcher loads.

## Out of scope

- Research-decision dispatch (001-07): research-tagged items sit open until then.
- Refining any resulting story (001-05).
- Slash shortcuts (001-05 ships them for both chat kinds).

## Open questions

None.
