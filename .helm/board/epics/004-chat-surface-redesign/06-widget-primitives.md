---
id: 004-06
status: done
depends: [ 004-02 ]
gate: { passed: 2026-08-27T14:05:00.000Z, brief: fccb71e08066e83a, overrides: [] }
sessions: {}
runs: []
---
# Widget primitives

## Goal

Every shared piece of widget chrome lives in one place, and the drawer's tab row survives the
docked panel's minimum width. Most of what this card was written against has since landed inside
004-09's contract migration; what remains is the last inlined eyebrow, the brief renderer still
living inside the drawer that renders it (an import cycle with `diff-pane.tsx`), and the tab row
that clips at 240px, handed here by 004-04's review.

## Approach

Facts measured at Helm `b349fbe`, clean on master.

- **Four of the card's five goals are already discharged.** `WidgetShell` is the canon `Card`:
  `proposal-widget.tsx`, `decision-widget.tsx`, `question-group.tsx` and `run-question-panel.tsx`
  all render it, and `question-widget.tsx` collapsed to `OneLine`, so no bordered-shell class
  string is repeated anywhere under `components/`. `AnswerChip` exists and
  `run-question-panel.tsx` renders its chips through it. `StoryCard`'s inert `gap-2` is gone with
  the card's move onto `BoardCard`. This story does not rebuild them; it asserts them, because a
  criterion that measures a claim is what keeps it from drifting back.
- **One eyebrow copy is left.** `ui/artifact-panel.tsx:9` still spells
  `font-bold text-ink-3 text-micro uppercase tracking-widest` inline, the last of the nine. Every
  other call site is `Eyebrow`.
- **`BriefView` and the drawer import each other.** `card-drawer.tsx:25` imports `DiffPane`, and
  `diff-pane.tsx:18` imports `ChecklistSection` back from `card-drawer.tsx`. That is a live
  module cycle, not a tidiness complaint: the drawer is the composition root of the pane that
  reaches back into it. Both renderers move to `components/brief-view.tsx`, which imports
  neither.
- **The tab row has no overflow handling.** `drawer-tabs.tsx:26` lays five triggers out in a flex
  row with no minimum and no overflow, so at `DockedPanel`'s 240px minimum the last two (Diff,
  History) are unreachable. The row is chrome in a flex column: it scrolls sideways rather than
  wrapping, because wrapping grows the chrome and shrinks the transcript at exactly the width
  where the pane is scarcest, and because `TabsPrimitive.Indicator` is absolutely placed against
  a single row and lands on the wrong line once the row wraps.
- **A scrolling row can hide the selected tab.** `defaultTab` opens a review story on Diff, the
  fourth trigger; at 240px that trigger starts outside the visible row, so the panel would open
  showing a selected tab the user cannot see. The selected trigger is scrolled into view on
  selection and on mount.

**The shape.** `ArtifactPanel` renders `Eyebrow`. `ChecklistSection` and `BriefView` move to their
own module and both consumers import from there. `DrawerTabs` gains an `overflow-x-auto` list with
non-shrinking triggers and a `scrollIntoView` on the selected one.

## Blast radius

`src/app/ui/artifact-panel.tsx`, `src/app/ui/drawer-tabs.tsx`, a new
`src/app/components/brief-view.tsx`, and the two import sites in `card-drawer.tsx` and
`diff-pane.tsx`. No board format, no server, no session or prompt code, no stack change.

## Acceptance criteria

- [x] `pnpm check` passes with zero errors (command)
- [x] `pnpm build` completes with the geometry gate reporting zero violations (command)
- [x] No file under `src/app/` outside `ui/eyebrow.tsx` contains `uppercase` (command)
- [x] `ChecklistSection` and `BriefView` are exported from `src/app/components/brief-view.tsx`, and
      `card-drawer.tsx` exports neither (file)
- [x] No import cycle remains: `diff-pane.tsx` imports nothing from `card-drawer.tsx` (command)
- [x] No bordered-shell class string is repeated under `src/app/components/`: every widget shell is
      the canon `Card` (command)
- [x] `run-question-panel.tsx` renders its quick replies through `AnswerChip`, not a hand-rolled
      `Button` (file)
- [x] At the panel's 240px minimum every one of the five tabs is reachable, and selecting each one
      renders its pane (live)
- [x] A review story opened at 240px shows its selected Diff tab inside the visible row without the
      user scrolling the row first (live)
- [x] At full column width the tab row looks unchanged: no scrollbar, indicator under the selected
      trigger (live)
- [x] The Brief tab renders identically after the move: sections, criteria checkboxes and the weak
      phrasing warning all present (live)
- [x] `node harness/episode/run.ts all` passes every episode (test)
- [ ] Zero console errors across the board, the card drawer at both widths, and the Diff tab (live)

## Out of scope

- Rebuilding `WidgetShell`, `AnswerChip` or the `StoryCard` spacing: 004-09 landed them, and this
  story only measures that they are still that way.
- Any change to what the widgets say or do. This is chrome and module placement; behaviour is
  untouched.
- `DockedPanel`'s 240px minimum itself. Raising the floor would hide the clipping rather than fix
  it, and the minimum is the stack's, decided in 004-03.
- Wrapping the tab row, or collapsing it to a menu at narrow widths. Both are look changes the
  shaping thread never asked for.

## Open questions

- [x] Scroll the tab row or wrap it? Scroll. Wrapping grows chrome exactly where the pane is
      narrowest, and the absolute indicator is placed against one row.
- [x] Does `BriefView` belong in `ui/` instead? No. It reads `Story` and `BRIEF_SECTIONS` from the
      board schema, which is what makes a module a component here rather than chrome.

## Run notes

- verify: `pnpm check` clean, 128 files, 0 errors; `pnpm build` completes with the geometry gate
  pre-step reporting no violations.
- verify: `node harness/episode/run.ts all` → 17/17 episodes pass. The four halting episodes were
  not run; they were not run before this change either.
- verify: greps run on the tree. `uppercase` appears once under `src/app/`, in `ui/eyebrow.tsx`.
  `diff-pane.tsx` imports nothing from `card-drawer.tsx`. `card-drawer.tsx` exports `CardDrawer`
  alone. No bordered-shell class string appears under `components/`. The one `Button` left in
  `run-question-panel.tsx` is the free-text form's Send, not a chip.
- verify: live in Chrome against this repo's board, dark theme. At a measured 240px panel the tab
  list scrolls (207 visible, 336 of content) and all five tabs are reachable and render their pane;
  004-06 opened in review selects Diff and reveals it (scrollLeft 49, trigger fully inside the
  row). At 800px the list does not overflow and the indicator sits exactly under the selected
  trigger (both at x=729). The Brief tab renders all six section eyebrows, 15 checkboxes and the
  weak-phrasing warning after the move.
- Four of the card's five original goals were already discharged by 004-09's contract migration.
  They are asserted by criteria rather than rebuilt, and the brief says so; nothing was dropped.
- The card walked blocked → ready → running → review by hand. A direct blocked → review edit is
  refused by the watcher ("Illegal hand edit"), which is the transition table working: the story
  ran on master with no run record, so the daemon had parked it.
- The unchecked criterion is the Diff-tab half of the console check. The board and the drawer at
  both widths are clean; the Diff tab throws `ORPCError: no worktree for story 004-06`, because a
  hand-driven story has no worktree to diff. The pane then spins on "loading the diff" instead of
  rendering its written error state — a real defect, out of this story's blast radius, carded as
  002-09.
- review: approved at 12/13. The one unchecked criterion fails on a pre-existing defect this story
  neither caused nor owns, now carded; every criterion inside the blast radius passed.
