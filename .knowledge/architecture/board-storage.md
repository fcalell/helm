# Board storage: markdown in the target repo

A board is a `.helm/` directory inside the repo it manages. Everything Helm writes into a repo lives
under `.helm/`: the board (`.helm/board/`), the repo's agent rules (`.helm/agents/`), its knowledge
base (`.helm/knowledge/`), and any template overrides. The one footprint outside `.helm/` is a single
line in the repo's root `CLAUDE.md`, `@.helm/agents/index.md`, which pulls Helm's rules into every
Claude Code session (native `@`-import, [claude-integration](./claude-integration.md)). Routing
through `agents/index.md` keeps a single file named `CLAUDE.md` in the repo (its own). Removing Helm
is deleting `.helm/` and that one line; an update touches only `.helm/`.

Files are the truth; the orchestrator and UI are views over them. Consequences: boards are git-versioned with the code they describe,
hand-editable in any editor (the file watcher live-reloads the UI), and readable by the
implementing agent mid-run (agent writes flow through board tools, §Mutation rules). The board
lives in the repo's server-side main checkout: chats run there, merges land there, and switching
that checkout's branch swaps the board out from under the orchestrator.

## Layout

```
.helm/
  agents/                # agent rule files; the repo's root CLAUDE.md imports agents/index.md
    index.md             # single entry point; imports the glossary and rule docs below
    glossary.md          # ubiquitous-language glossary
    <topic>.md           # additional Helm-managed rule docs
  knowledge/             # the knowledge base (what/why docs), pulled on demand
    index.md             # navigation map, referenced from agents/index.md
  templates/             # per-repo generation-template overrides
  board/                 # orchestrator runtime state: watched, worktree-excluded
    shaping/
      offline-sync.md    # a roadmap thread: shape-chat session id + agreed notes
    epics/
      012-offline-sync/
        epic.md          # goal, epic-chat session id, breakdown rationale
        01-sync-engine.md  # one story = one file
        02-conflict-ui.md
```

IDs are `<epic>-<story>` ordinal pairs (`012-01`), stable forever; slugs can be renamed, IDs
can't. A deleted epic or story retires its ordinal: new entries mint the next number, so a
reference in git history stays unambiguous.

## Classification

One classifier decides what each path under `.helm/board/` is; the loader and the watcher both
consume it, so a fresh load and a live edit never disagree. All board content lives under
`.helm/board/`, which holds two directories, `shaping/` and `epics/`; the rest of `.helm/`
(`agents/`, `knowledge/`, `templates/`) is Helm's rules, knowledge, and templates, outside the
board and watched by nothing. The policy, at every depth:

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
gate: { passed: 2026-07-14T18:03:00Z, brief: <hash>, overrides: ["<flag>: <reason>"] }
sessions: { refine: <uuid> }
runs:                 # one entry per implement session; request-changes follow-ups extend it
  - { n: 1, session: <uuid>, brief: <hash>, started: 2026-07-15T09:12:00Z, outcome: review, grades: 5/6, tokens: 184000, minutes: 22 }
---
# Sync engine
## Goal
## Approach
## Blast radius
## Acceptance criteria
## Out of scope
## Open questions
```

Acceptance criteria and Open questions are `- [ ]` checklists. A checked criterion is verified:
the review session checks one only when automated evidence proves it (a test it ran and passed),
the human checks the rest at review ([review](../product/features/review.md) §Self-grading). A
checked question is resolved, and unresolved questions are what the ready gate counts
([define-refine](../product/features/define-refine.md) §Ready gate).

`gate` records the adversary pass: timestamp, the hash of the brief body it binds to, and the
dismissed flags with their override reasons; any brief edit stales it
([define-refine](../product/features/define-refine.md) §Ready gate). A run entry records the
brief hash the run was spawned with (the contract review grades against,
[runs](../product/features/runs.md)) and, once graded, the self-grade tally the Review card
shows. One entry spans one implement session: request-changes follow-ups accumulate onto it, and
a new entry starts when discard retires the session
([review](../product/features/review.md) §Three exits).

The orchestrator writes frontmatter in fixed key order (id · status · depends · branch · gate ·
sessions · runs) with one flow-styled run per line, so a rewrite diffs as exactly the lines that
changed.

`epic.md` has the same shape: frontmatter holds `sessions: { define: <uuid> }` (the epic chat);
the body is `# Title`, the goal, and the breakdown rationale. A shaping thread under
`.helm/board/shaping/` holds `sessions: { shape: <uuid> }`, the agreed roadmap notes, and a Decisions
checklist (the
feature-level open questions the breakdown waits on,
[define-refine](../product/features/define-refine.md) §Shaping the roadmap); accepting its proposals
writes new epics, so it is a source of cards rather than a card.

## Mutation rules

- **The orchestrator is the single writer.** UI drags, accepted proposal widgets, queue/run
  events, and hook POSTs all land as orchestrator writes to the main checkout, so concurrent
  writers and read-modify-write races are designed out rather than locked around. A Stop hook
  writes frontmatter directly only when the orchestrator is unreachable
  ([claude-integration](./claude-integration.md) §Hooks).
- **Chat never writes board files.** Accepting a proposal widget is the single mutation path from
  conversation ([define-refine](../product/features/define-refine.md) §Proposal widgets).
- The implementing agent notes decisions and progress on its **own** card's body through the
  `update_card` tool, never by editing files. It never touches acceptance-criteria checkboxes
  (those belong to review, [review](../product/features/review.md) §Self-grading) or status;
  status flows through run events.
- **Hand edits stay legal** (files are the truth) but the watcher validates them: malformed
  frontmatter or an illegal status transition is surfaced in the UI and never acted on (no run
  spawns from a hand-typed `running`).
- **Deletion is the terminal move.** Dropping a story, archiving a finished epic, or clearing a
  spent shaping thread deletes the file or folder after an explicit confirmation; git history is
  the archive, so no archive directory and no `dropped` status exist.

## Worktrees

Worktrees live outside the repo working tree, under an orchestrator-owned directory
(`~/.helm/worktrees/<repo>/<story-id>/`), one per story, created at first run and deleted on
approve/discard ([review](../product/features/review.md) §Three exits). The story branch is the
durable artifact; the worktree is disposable.

Worktrees are created with a sparse checkout that excludes the board state (`.helm/board/`): a story
branch never carries board changes, so story files can't conflict at
rebase or merge and ephemeral state (a `running` status) never enters git history through a run. The
rest of `.helm/` stays in the worktree, so a run still loads the repo's Helm rules through the root
`CLAUDE.md` import. The run reads its brief from the prompt and updates its card through board tools
(§Mutation rules).
