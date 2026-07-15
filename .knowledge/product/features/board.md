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
- **Agent events move cards on their own**: a finished run flips Running → Review, a mid-run
  question flips Running → Needs input, via hooks writing frontmatter
  ([claude-integration](../../architecture/claude-integration.md) §Hooks).
- The **ready gate** is the one hard transition: a story cannot enter Ready with empty acceptance
  criteria or unresolved open questions ([define-refine](./define-refine.md) §Ready gate).

## Card anatomy

Title · epic tag · status · acceptance-criteria count · dependency hint ("needs #12.2"). Stage
extras: Refining shows open-question count; Ready shows estimated blast radius (files/LOC guess, an
eyeball risk signal before running); Running shows a live one-line activity summary; Review shows
the self-grade tally (5/6 ✓) and diff stats; Done shows time + token cost of its runs.

Glanceability laws: **running cards animate; nothing else does** (the board answers "what is alive
right now"), and **every card shows its cost after a run** (builds intuition for what refinement
quality buys).

## Epics

Epics render as toggleable swimlanes over the same columns. An epic card opens its own chat drawer
(same interaction as a story, one level up) and shows rolled-up progress (stories done/total).
Dependency hints between sibling stories come from the epic breakdown; v1 renders them, the
dependency-aware queue is deferred ([roadmap](../roadmap.md) §Later).

## Screen layout

One screen: board + a right-hand **drawer**, never a page navigation away. Selecting a card opens
the drawer on tabs **Brief | Chat | Activity | Diff | History**; the default tab follows status
(Refining → Chat, Running → Activity, Review → Diff). The header carries the target repo/branch, the
rate-limit meter, and queue occupancy. Keyboard-first: `j/k` move, `enter` opens, `n` new story,
`e` epic view, `r` run/refine per status, `⌘k` command palette. Narrow screens collapse to the
mobile surface ([mobile](./mobile.md)).
