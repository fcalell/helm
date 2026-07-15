# Board storage: markdown in the target repo

A board is a `.helm/` directory inside the repo it manages. Files are the truth; the orchestrator
and UI are views over them. Consequences: boards are git-versioned with the code they describe,
hand-editable in any editor (the file watcher live-reloads the UI), and readable/writable by the
implementing agent itself mid-run.

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
sessions: { refine: <uuid>, implement: <uuid> }
runs:
  - { n: 1, started: 2026-07-15T09:12:00Z, outcome: review, tokens: 184k, minutes: 22 }
---
# Sync engine
## Goal
## Approach
## Acceptance criteria
## Out of scope
## Open questions
```

## Mutation rules

- **Chat never writes board files.** Accepting a proposal widget is the single mutation path from
  conversation; the orchestrator performs the write
  ([define-refine](../product/features/define-refine.md) §Proposal widgets).
- **Status is written by whoever knows first**: the UI on a drag, the orchestrator on queue/run
  events, a session's Stop hook on run end ([claude-integration](./claude-integration.md) §Hooks).
  Frontmatter is the reconciliation point; the watcher makes every writer's change everyone's.
- The implementing agent may update its **own** card's body (checking off criteria, noting a
  decision) but never its status field directly; status flows through hooks.

## Worktrees

Worktrees live outside the repo working tree, under an orchestrator-owned directory
(`~/.helm/worktrees/<repo>/<story-id>/`), one per story, created at first run and deleted on
approve/discard ([review](../product/features/review.md) §Three exits). The story branch is the
durable artifact; the worktree is disposable.
