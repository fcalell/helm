# Board: a state machine over files

The board renders three nouns. An **epic** is a goal with its own conversation, a folder under the
target repo's `.helm/`. A **story** is a card, one markdown file whose body is the brief. A **run**
is one headless Claude Code execution against a story, in its own git worktree. On-disk shapes live
in [board-storage](../../architecture/board-storage.md).

## Status state machine

```
Backlog → Refining → Ready → Running → Review → Done
                                 ↕
                            Needs input        (+ Blocked, parked from any column)
```

- Columns are statuses, not free-form lanes. **Drag-and-drop only performs legal transitions**;
  illegal drops snap back with the reason (e.g. "no acceptance criteria yet").
- Legal transitions: `backlog → refining` · `refining → backlog | ready` ·
  `ready → refining | running` · `running → needs-input | review` · `needs-input → running` ·
  `review → done | running | ready` (the three exits, [review](./review.md)) ·
  `blocked → backlog | refining | ready` · any status but `done` → `blocked`. The ready gate
  guards every move into Ready; a still-valid verdict passes for free, so discard's
  `review → ready` re-parks without a fresh adversary run
  ([define-refine](./define-refine.md) §Ready gate).
- **Agent events move cards on their own**: a finished run flips Running → Review via the Stop
  hook backstop, a mid-run `ask_user` call flips Running → Needs input
  ([claude-integration](../../architecture/claude-integration.md) §Board tools, §Hooks).
- The **ready gate** is the one hard transition: a story cannot enter Ready while the adversary
  review holds an unresolved critical flaw, acceptance criteria are empty, or open questions remain
  ([define-refine](./define-refine.md) §Ready gate).
- Two waits render as **sub-state badges**, never statuses: Refining shows a gating indicator
  while the adversary runs ([define-refine](./define-refine.md) §Ready gate), Review shows a
  rebasing indicator while a conflict session resolves ([review](./review.md) §Two axes).
- Work leaves the board by **deletion**: dropping a story or archiving a finished epic is an
  explicit, confirmed delete, and git history is the archive
  ([board-storage](../../architecture/board-storage.md) §Mutation rules).

## Card anatomy

Title · epic tag · status · acceptance-criteria count · dependency hint ("needs #12.2"). Stage
extras: Refining shows open-question count; Ready shows the brief's blast-radius estimate (filled during
refinement, an eyeball risk signal before running); Running shows a live one-line activity summary; Review shows
the self-grade tally (5/6 ✓) and diff stats; Done shows time + token cost of its runs.

Glanceability laws: **running cards animate; nothing else does** (the board answers "what is alive
right now"), and **every card shows its cost after a run** (builds intuition for what refinement
quality buys).

## Epics

The board is one grid: the status columns head it once, and each epic is a **band** of cells
beneath them, one cell per status, so an epic's whole state reads on one row and the board scrolls
as one pane on both axes. A band's title line shows rolled-up progress (stories done/total) and
opens the epic's own chat drawer (same interaction as a story, one level up). A band collapses to
its title line; an epic whose stories are all done sorts last and starts collapsed. Stories naming
an epic with no file render in a band of their own, with no chat.
Dependency hints between sibling stories come from the epic breakdown; v1 renders them, the
dependency-aware queue is deferred ([roadmap](../roadmap.md) §Later).

## Shaping

Cards start upstream of the board, in a shaping chat: a board-level conversation with no card yet
that talks a feature into epics and their first stories
([define-refine](./define-refine.md) §Shaping the roadmap). Shaping is reached from the header, not
a column, and its output is accepted epics and Backlog cards. That is where the state machine above
begins.

## Screen layout

One screen: board + a right-hand **drawer**, never a page navigation away. The drawer is a docked
panel in the board's layout flow, not an overlay: it opens at 90vw, leaving a strip of board
beside it, and its drag handle resizes it up to 95vw with the width persisted across reloads.
One chat surface is open at a time; selecting another replaces it, and close is the chrome
row's one control. Selecting a card opens the drawer on its **properties** (epic, preset,
dependencies), a **stage block** naming what the status means and carrying the one action that
moves the story on (Backlog → Start refining, Refining → Move to Ready, Ready → Run, Needs input →
the run's question, Review → the three exits), and tabs **Brief | Chat | Activity | Diff |
History**; the default tab follows status (Refining → Chat, Running → Activity, Review → Diff). Repo-level surfaces sit beside the board,
reached from the header rather than a card drawer: the shaping chat (§Shaping) and
a **rules & knowledge surface** for viewing, chat-curating, and lightly editing the repo's
`.helm/agents/` rules and `.helm/knowledge/` docs, Helm's own markdown and never the repo's code
([roadmap](../roadmap.md) §Later). The header carries the target repo/branch, the rate-limit meter,
queue occupancy, and a **standing-context meter** (the tokens that load every session,
[init](./init.md) §Migrating an existing repo). Button-first: every action is a visible control.
Cards are passive (a click opens the drawer; the only control a card ever carries is a run's
permission prompt, [runs](./runs.md) §Permission presets), the drawer's stage block carries the
story's one action, the header carries the board-level entries (Shape, New epic), and no
app-level hotkey layer exists; native focus activation (Enter/Space on a focused card, a dialog's
own Escape dismiss) is the only keyboard behavior. Narrow screens collapse to the
mobile surface ([mobile](./mobile.md)).
