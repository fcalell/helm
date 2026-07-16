# Board storage: markdown in the target repo

A board is a `.helm/` directory inside the repo it manages. Files are the truth; the orchestrator
and UI are views over them. Consequences: boards are git-versioned with the code they describe,
hand-editable in any editor (the file watcher live-reloads the UI), and readable by the
implementing agent mid-run (agent writes flow through board tools, §Mutation rules). The board
lives in the repo's server-side main checkout: chats run there, merges land there, and switching
that checkout's branch swaps the board out from under the orchestrator.

## Layout

```
.helm/
  shaping/
    offline-sync.md      # a roadmap thread: shape-chat session id + agreed notes
  epics/
    012-offline-sync/
      epic.md            # goal, epic-chat session id, breakdown rationale
      01-sync-engine.md  # one story = one file
      02-conflict-ui.md
```

IDs are `<epic>-<story>` ordinal pairs (`012-01`), stable forever; slugs can be renamed, IDs
can't.

## Classification

One classifier decides what each path under `.helm/` is; the loader and the watcher both consume
it, so a fresh load and a live edit never disagree. Two top-level directories are classified,
`shaping/` and `epics/`. The policy, at every depth:

- Dotfiles are ignored.
- Under `shaping/`, only `<slug>.md` shaping threads are valid; every other entry is invalid. A
  shaping thread carries a `shape` session id and the agreed roadmap notes, and its accepted
  proposals write new epics ([define-refine](../product/features/define-refine.md) §Shaping the
  roadmap).
- Epic directories are `<NNN>-<slug>/`; every other entry directly under `epics/` is invalid.
- Inside an epic directory only `epic.md` and story files `<NN>-<slug>.md` are valid; every other
  entry (a stray file, an editor dropping like `01-x.md~`, a subdirectory) is invalid.
- Ordinals are unique: two directories parsing to the same epic number, or two files to the same
  story number in one epic, are **all** invalid — no winner is elected, so a restart shows what was
  live. Deleting the collision rehabilitates the survivor.

An invalid path is dropped from the board (its content is never guessed at) and listed in the
invalid banner while the file exists.

## Story file

Frontmatter is machine state; the body is the brief, in the fixed template order.

```markdown
---
id: 012-01
status: review        # backlog|refining|ready|running|needs-input|review|done|blocked
depends: []           # sibling story ids
branch: helm/012-01-sync-engine
sessions: { refine: <uuid> }
runs:                 # one entry per attempt; each keeps its own implement session
  - { n: 1, session: <uuid>, started: 2026-07-15T09:12:00Z, outcome: review, tokens: 184000, minutes: 22 }
---
# Sync engine
## Goal
## Approach
## Acceptance criteria
## Out of scope
## Open questions
```

Acceptance criteria and Open questions are `- [ ]` checklists: a checked criterion is done, a
checked question is resolved, and unresolved questions are what the ready gate counts
([define-refine](../product/features/define-refine.md) §Ready gate). The orchestrator writes
frontmatter in fixed key order (id · status · depends · branch · sessions · runs) with one
flow-styled run per line, so a rewrite diffs as exactly the lines that changed.

`epic.md` has the same shape: frontmatter holds `sessions: { define: <uuid> }` (the epic chat);
the body is `# Title`, the goal, and the breakdown rationale. A shaping thread under `.helm/shaping/`
holds `sessions: { shape: <uuid> }` and the agreed roadmap notes; accepting its proposals writes new
epics, so it is a source of cards rather than a card.

## Mutation rules

- **The orchestrator is the single writer.** UI drags, accepted proposal widgets, queue/run
  events, and hook POSTs all land as orchestrator writes to the main checkout, so concurrent
  writers and read-modify-write races are designed out rather than locked around. A Stop hook
  writes frontmatter directly only when the orchestrator is unreachable
  ([claude-integration](./claude-integration.md) §Hooks).
- **Chat never writes board files.** Accepting a proposal widget is the single mutation path from
  conversation ([define-refine](../product/features/define-refine.md) §Proposal widgets).
- The implementing agent updates its **own** card's body (checking off criteria, noting a
  decision) through the `update_card` tool, never by editing files, and never touches status;
  status flows through run events.
- **Hand edits stay legal** (files are the truth) but the watcher validates them: malformed
  frontmatter or an illegal status transition is surfaced in the UI and never acted on (no run
  spawns from a hand-typed `running`).

## Worktrees

Worktrees live outside the repo working tree, under an orchestrator-owned directory
(`~/.helm/worktrees/<repo>/<story-id>/`), one per story, created at first run and deleted on
approve/discard ([review](../product/features/review.md) §Three exits). The story branch is the
durable artifact; the worktree is disposable.

Worktrees are created with a sparse checkout that excludes `.helm/`: a story branch never carries
board changes, so story files can't conflict at rebase or merge and ephemeral state (a `running`
status) never enters git history through a run. The run reads its brief from the prompt and
updates its card through board tools (§Mutation rules).
