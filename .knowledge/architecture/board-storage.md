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
  epics/
    012-offline-sync/
      epic.md            # goal, epic-chat session id, breakdown rationale
      01-sync-engine.md  # one story = one file
      02-conflict-ui.md
```

IDs are `<epic>-<story>` ordinal pairs (`012-01`), stable forever; slugs can be renamed, IDs
can't.

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
  - { n: 1, session: <uuid>, started: 2026-07-15T09:12:00Z, outcome: review, tokens: 184k, minutes: 22 }
---
# Sync engine
## Goal
## Approach
## Acceptance criteria
## Out of scope
## Open questions
```

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
