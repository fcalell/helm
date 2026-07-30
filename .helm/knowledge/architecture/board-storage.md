# Board storage: markdown in the target repo

A board is a `.helm/` directory inside the repo it manages. Everything Helm writes into a repo lives
under `.helm/`: the board (`.helm/board/`), the repo's agent rules (`.helm/agents/`), its knowledge
base (`.helm/knowledge/`), its working evidence (`.helm/research/`), the run config
(`.helm/config.json`), and any template overrides. The one footprint outside `.helm/` is a single
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
    index.md             # single entry point; imports the glossary and the knowledge index
    glossary.md          # ubiquitous-language glossary
    <topic>.md           # additional Helm-managed rule docs, pulled on demand
  knowledge/             # the knowledge base (what/why docs), pulled on demand
    index.md             # navigation map, imported by agents/index.md
  research/              # working evidence: experiment plans, ledgers, findings (§Research)
    index.md             # navigation map
  templates/             # per-repo generation-template overrides
  config.json            # optional run config: Auto-allowlist override + check command ([runs](../product/features/runs.md) §Permission presets)
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
reference in git history stays unambiguous. Minting (`src/board/ordinals.ts`) scans the live tree
plus git's added-path history (`git log --diff-filter=A` over `.helm/board/epics`), which is what
retires a deleted ordinal permanently; a repo with nothing committed yet falls back to the live
tree alone.

## Classification

One classifier decides what each path under `.helm/board/` is; the loader and the watcher both
consume it, so a fresh load and a live edit never disagree. All board content lives under
`.helm/board/`, which holds two directories, `shaping/` and `epics/`; the rest of `.helm/`
(`agents/`, `knowledge/`, `research/`, `templates/`) is Helm's rules, knowledge, evidence, and
templates, outside the board and watched by nothing. The policy, at every depth:

- Dotfiles are ignored.
- Under `shaping/`, only `<slug>.md` shaping threads are valid; every other entry is invalid. A
  shaping thread carries a `shape` session id and the agreed roadmap notes, and its accepted
  proposals write new epics ([define-refine](../product/features/define-refine.md) §Shaping the
  roadmap).
- Epic directories are `<NNN>-<slug>/`; every other entry directly under `epics/` is invalid.
- Inside an epic directory only `epic.md` and story files `<NN>-<slug>.md` are valid; every other
  entry (a stray file, an editor dropping like `01-x.md~`, a subdirectory) is invalid.
- Ordinals are unique: two directories parsing to the same epic number, or two files to the same
  story number in one epic, are **all** invalid: no winner is elected, so a restart shows what was
  live. Deleting the collision rehabilitates the survivor.

An invalid path is dropped from the board (its content is never guessed at) and listed in the
invalid banner while the file exists.

## Research

`.helm/research/` holds the working evidence a repo produces about its own build: experiment plans,
measurement ledgers, and findings not yet settled. It exists because `.helm/knowledge/` is durable
present-tense reference and rejects dated, draining, or superseded material, which otherwise has
nowhere to go and silts up `.helm/` root. An `index.md` maps it, one folder per experiment, and
nothing here auto-loads.

Two rules keep it from growing without bound. A settled conclusion is **promoted** into the
`.helm/knowledge/` entry it governs, and the research doc stays as the evidence behind it. A
**drained** doc is deleted, since git history is the archive. Raw session data is reproducible from
the CLI's own transcripts, so a repo gitignores it rather than committing it.

## Story file

Frontmatter is machine state; the body is the brief, in the fixed template order.

```markdown
---
id: 012-01
status: review        # backlog|refining|ready|running|needs-input|review|done|blocked
depends: []           # sibling story ids
branch: helm/012-01-sync-engine
preset: auto          # guarded|auto|manual; absent means guarded, the default
gate:                 # the verdict, the override register, and the rounds spent so far
  passed: 2026-07-14T18:03:00Z
  brief: <hash>
  overrides:
    - "<flag>: <reason>"
  rounds:
    - n: 1
      flags:
        - { title: <flag>, status: dismissed }
sessions: { refine: <uuid> }
runs:                 # one entry per implement session; request-changes follow-ups extend it
  - { n: 1, session: <uuid>, brief: <hash>, started: 2026-07-15T09:12:00Z, outcome: review, grades: 5/6, stat: 3 files +42 -7, tokens: 184000, minutes: 22 }
  - { n: 2, session: <uuid>, brief: <hash>, started: 2026-07-16T10:02:00Z, outcome: blocked, error: orchestrator restarted mid-run }
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

`gate` is the story's persistent gate record. `passed` and `brief` are the verdict, the timestamp
and the hash of the brief body it binds to; they are written together and parse only as a pair, so
a half-written pair is an invalid file rather than a passed-but-unverified gate. Any brief edit
stales the verdict ([define-refine](../product/features/define-refine.md) §Ready gate).
`overrides` holds the passing attempt's dismissed flags with their reasons. `rounds` accumulates
every adversary round as it is spent: the round's number and the flags it raised, each at its last
known status, so a round interrupted before its verdict still counts and a flag frozen at `open`
or `contested` is the truth about what happened. A block with `rounds` and no `brief` is history
without a verdict, which is what a story mid-gate carries.

The record exists only while the story is refining. Every orchestrator write that moves a story
out of refining drops `rounds` in the same write and drops the live attempt with it: the pass, the
recorded-verdict fast path back into Ready, and the drag to `backlog` or `blocked`. A hand-edited
status is the one path outside all three, and the next round on that story appends to what is
there. The hash excludes the body's
trailing `## Run notes` block (from the final such heading to the next `##` heading or end of
body): run notes are bookkeeping appends, so they never stale the verdict, while anything a hand
edit adds after the section re-enters the hash and stales it. A run entry records the
brief hash the run was spawned with (the contract review grades against,
[runs](../product/features/runs.md)), the outcome with its token/minute totals, the last error
when the run ended blocked, and, once graded, the self-grade tally the Review card
shows. A review close also records `stat` (`"N files +A -D"`, the branch's `git diff --shortstat`
against main after the close's rebase); the Review card face shows it. One entry spans one
implement session: request-changes follow-ups accumulate onto it, and
a new entry starts when discard retires the session
([review](../product/features/review.md) §Three exits). A request-changes exit reopens the last
entry: `outcome`, `error`, and `stat` are deleted so the close path treats it as the open entry
again, while `tokens`/`minutes` stay and keep summing across the follow-up's segments; the next
close rewrites `outcome` and `stat` fresh.

An open run entry (no `outcome` yet) whose run called `ask_user` carries the pending question as
`question: { text, recommendation, options }`: frontmatter keeps it across orchestrator restarts,
the drawer's quick-reply form renders from it, and `run.answer` deletes it when the resume starts
([runs](../product/features/runs.md) §Needs input). A run's `tokens`/`minutes` sum across its
segments (each CLI result event counts only its own turn), so a needs-input round trip lands in
Review with both segments counted on the same entry.

A paused run carries `paused: true` on the open entry: the card stays `running` with no live
process, restart reconciliation leaves it intact (its segment's safety commit ran at pause time),
and the resume's init write deletes the flag. The field is written only as `true` and never
survives onto a closed entry (the stop and finish writes drop it).

The orchestrator writes frontmatter in fixed key order (id · status · depends · branch · preset ·
gate · sessions · runs) with one flow-styled run per line, so a rewrite diffs as exactly the lines
that changed. The `gate` container follows the same rule conditionally: it stays flow-styled on
one line while it holds no rounds and no overrides, and becomes a block map as soon as either list
is non-empty, with `rounds`, each round's `flags` and `overrides` written as block sequences (a
flag stays a flow map on its own line). Flow containers do not wrap, so a flow container holding a
list would render as one line that grows with the list. An empty `rounds` is omitted, and a `gate`
holding no verdict, no rounds and no overrides is dropped entirely, so a cleared record leaves no
residue. `preset` is optional; an absent field means Guarded, so pre-preset cards keep parsing
with no migration.

`epic.md` has the same shape: frontmatter holds `sessions: { define: <uuid> }` (the epic chat);
the body is `# Title`, the goal, and the breakdown rationale. A shaping thread under
`.helm/board/shaping/` holds `sessions: { shape: <uuid> }`, an `## Agreed notes` section (seeded
with the rough goal; decision resolutions append `- <decision>: <answer>` lines), and a
`## Decisions` checklist (the feature-level open questions the breakdown waits on,
[define-refine](../product/features/define-refine.md) §Shaping the roadmap). A research-tagged
decision carries a trailing `(research)` marker on its checklist line; untagged items are human
decisions. Accepting the thread's proposals writes new epics, so it is a source of cards rather
than a card.

## Mutation rules

- **The orchestrator is the single writer.** UI drags, accepted proposal widgets, queue/run
  events, and hook POSTs all land as orchestrator writes to the main checkout, so concurrent
  writers and read-modify-write races are designed out rather than locked around. The run's Stop
  hook POSTs to the orchestrator and never writes board files
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
approve/discard ([review](../product/features/review.md) §Three exits). Creation runs the repo's
`worktreeSetup` command when one is configured, so a fresh checkout is bootstrapped (dependencies
installed, generated files present) before any run or check executes in it
([runs](../product/features/runs.md) §Permission presets). The story branch is the
durable artifact; the worktree is disposable. Per-story run artifacts sit beside the worktrees in
the same directory: `<story-id>.brief.md` (the brief's spawn snapshot, seeding every segment,
[claude-integration](./claude-integration.md) §Context management), `<story-id>.check.json`
(the review close's check evidence, `{ command, exitCode, output, finishedAt }` with the output
tail capped and `exitCode: null` on timeout; absent when no check command is configured),
`<story-id>.settings.json` (the per-spawn CLI settings), and `<story-id>.pid` (the live run's
process id, for restart reconciliation). Approve and discard delete all four with the worktree;
the story file itself keeps the brief and run history.

Worktrees are created with a sparse checkout that excludes the board state (`.helm/board/`) and the
working evidence (`.helm/research/`): a story branch never carries board changes, so story files
can't conflict at rebase or merge and ephemeral state (a `running` status) never enters git history
through a run, and research is bulk a run never reads. The rest of `.helm/` stays in the worktree,
so a run still loads the repo's Helm rules through the root `CLAUDE.md` import. The run reads its brief from the system-prompt seed
([claude-integration](./claude-integration.md) §Context management) and updates its card through
board tools (§Mutation rules).
