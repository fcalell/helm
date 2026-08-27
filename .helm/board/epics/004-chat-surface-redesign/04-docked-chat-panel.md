---
id: 004-04
status: done
depends: [ 004-03 ]
gate: { passed: 2026-08-27T10:54:02.330Z, brief: d5a5500390604da5, overrides: [] }
sessions: {}
runs: []
---
# Docked chat panel

## Goal

One `ChatDrawer` hosts every chat surface as a layout region beside the board: drag-resizable,
width persisted, open whenever a card or board-level chat is selected, the board scrolling and
dragging on in the remaining width. It replaces the overlay dialog in `src/app/ui/drawer.tsx`,
which is fixed at 75vw or `xl`, resets its expanded state on close, and dodges its own
absolutely-positioned close button with padding. Close and expand move into one chrome row, so the overlap becomes unrepresentable
rather than avoided. board.md §Screen layout is updated to describe the docked panel, the spec
change decided in [chat-surface-redesign](../../shaping/chat-surface-redesign.md).

## Approach

Facts measured at Helm `51c64a6` and stack `c06f859`, both clean on master.

- **The shell is already shared.** 004-09 collapsed the three copy-pasted `Sheet` shells into
  `src/app/ui/drawer.tsx` (85 lines), which all three drawers import (`card-drawer.tsx:19`,
  `define-drawer.tsx:10`, `shaping-drawer.tsx:13`). What is still duplicated is small: each
  drawer keeps its own `expanded` signal and resets it in `onOpenChange`
  (`card-drawer.tsx:195-205`, `define-drawer.tsx:35-45`, `shaping-drawer.tsx:163-173`), and each
  assembles its own header row. The epic's original framing of this story as a de-duplication is
  spent; what remains is the overlay-to-docked move.
- **The overlay is a Kobalte dialog.** `drawer.tsx:24-46` portals a dimmed overlay and sizes the
  panel with `sheetVariants({ position: "right", size: expanded ? "full" : "xl" })`. Nothing is
  resizable, no width persists, and the board never yields width because the panel is not in its
  layout flow.
- **The close button is positioned, not placed.** `drawer.tsx:38` pins it `absolute top-4 right-4`
  and `DrawerHeader` (`drawer.tsx:53`) carries `pr-8` to keep the trailing controls clear of it.
  `DockedPanel.Chrome` is the row that makes the dodge unnecessary.
- **The primitives are on disk.** Stack ships `DockedPanel` (root, `Chrome`, `Content`) and
  `createPanelWidth` in `plugins/solid-ui/src/ui/components/docked-panel/index.tsx`, reachable as
  `@fcalell/plugin-solid-ui/components/docked-panel` through the package's `./components/*`
  exports subpath. Helm consumes stack over a `link:` workspace dep, so no version bump. The root
  takes `side`, controlled `width` / `onWidthChange`, `minWidth` / `maxWidth`, and renders an ARIA
  window-splitter handle with pointer drag and arrow-key resize.
- **`DockedPanel.Content` is its own scroll owner** (`min-h-0 flex-1 overflow-y-auto`, block not
  flex), the same shape that kept 004-09 off `Sheet.Content`. `ChatPane` (`chat-pane.tsx:159-162`)
  is a fill column holding a capped `ArtifactPanel`, a `ScrollArea`, and a pinned composer, so it
  cannot compose inside a scrolling parent. The panel body is the `DockedPanel` root plus `Chrome`
  plus Helm's own fill region; `Content` goes unused.
- **The docking row is new.** `Frame` (stack `frame/index.tsx`) is `flex h-dvh min-h-0 flex-col
  overflow-hidden` and closes `class`, so the board body and the panel sit side by side in a bare
  `div` inside it. That row is the frame's one flexing region and needs `min-h-0` itself.
  `BoardStrip` and `BoardStack` (`ui/board-surface.tsx:10,19`) already shrink in a row: both are
  scroll containers, so their automatic minimum width is zero. Columns do not compress with them:
  `ColumnFrame` is `w-72 shrink-0` (`ui/column-frame.tsx:19`), so the docked panel narrows the
  strip and the strip scrolls sideways, which is the behavior this story ships.
- **The chrome row holds panel controls only.** `DockedPanel.Chrome` is a single `h-12` row with
  no wrap; the card header's surface controls (Move to Ready, `PresetSelector`,
  `card-drawer.tsx:213-222`) overflow it at narrow widths, which is why the old `DrawerHeader`
  wrapped. They move to an intrinsic row below the chrome, the slot `ReviewExits` and
  `RunQuestionPanel` already render in.
- **The gate permits the row.** `packages/ui-core/src/gate.ts` allows a class attribute on a bare
  lowercase tag carrying the closed vocabulary, and `flex`, `flex-1`, `min-h-0` and
  `overflow-hidden` are all members. `src/app/ui/` is skipped, so the panel shell's own geometry
  is unconstrained.
- **Three open states become one.** `pages/index.tsx:87-105` renders `CardDrawer`, `ShapingDrawer`
  and `DefineDrawer` as sibling overlays, each with its own open signal. A stack of overlays
  tolerates that; one docked region does not, so the page holds a single selection.

**The shape.** `src/app/ui/chat-drawer.tsx` replaces `drawer.tsx`: the `DockedPanel` root wired to
`createPanelWidth`, a `Chrome` row carrying title, badge slot, expand and close, and a fill
region below it; surface controls stay in the body. The panel is not a dialog, so Kobalte's
focus trap and Escape dismiss go away with the overlay; closing is the chrome button, the
reading board.md §Screen layout already supports by scoping Escape to a dialog's own dismiss.
Helm passes a max of 75vw in pixels (today's expanded width; `maxWidth` takes a number). Expand
sits beside the persisted width, never inside it: the panel renders
`width={expanded ? max : persisted}` and `onWidthChange` writes the persisted value and clears
`expanded`, so toggling never clobbers the width a drag chose and a drag ends the expanded
state. The expanded flag no longer resets on close. `pages/index.tsx` collapses its three open
signals into one selection naming which surface is active, so exactly one panel renders and a
second selection replaces the first. The three drawer components keep their bodies and their
header contents, and give up their `expanded` signals and shells.

## Blast radius

`src/app/ui/drawer.tsx` (replaced by `chat-drawer.tsx`), `src/app/ui/board-surface.tsx`,
`src/app/pages/index.tsx`, the three drawer components, `src/app/components/expand-toggle.tsx`
(moves into the chrome row), and `.helm/knowledge/product/features/board.md` §Screen layout. No
orchestrator, board, session, or harness code.

## Acceptance criteria

- [x] `pnpm check` passes with zero errors (command)
- [x] `pnpm build` completes and the geometry gate reports zero violations over `src/` (command)
- [x] Selecting a card opens the panel beside the board with no dimming overlay, and the board
      strip scrolls sideways in the remaining width with its columns at full size (live)
- [x] Dragging the panel's edge resizes it between its min and max, and the width is still there
      after a reload (live)
- [x] The splitter takes keyboard focus and arrow keys resize it (live)
- [x] Opening a second chat surface while one is open replaces it; exactly one panel is ever
      rendered (live)
- [x] Close and expand sit in one chrome row and overlap at no width between min and max (live)
- [x] Expand toggles between the persisted width and the max, and the toggle's state survives
      closing and reopening the panel (live)
- [ ] The panel keeps the fill-and-scroll layout at both min and max width: intrinsic artifact
      panel, scrolling transcript, composer pinned below (live)
- [x] Dragging a card between columns still works with the panel open (live)
- [x] `src/app/ui/chat-drawer.tsx` contains no absolutely-positioned close button and no `pr-8`
      dodge (file)
- [x] board.md §Screen layout describes the docked panel, its resize and its persistence (file)
- [x] Zero console errors across board, card panel, shaping panel, define panel and epic view
      (live)

## Out of scope

- The conversation itself: merging `ActivityPane` into `ChatPane`, `Prose`, and the scroll model
  are 004-05.
- Widget and eyebrow primitives (004-06) and acceptance feedback (004-07).
- The mobile surface. board.md sends narrow screens to the mobile surface and that epic owns what
  a docked panel does there.
- The `Sheet` close-button opt-out 004-03 shipped. Helm's shell composes Kobalte directly and
  never reaches it.

## Open questions

- [x] One active chat surface at a time, or can a card chat and a shaping chat both stay open?
      One: the panel is a single region, and a second selection replaces the first.
- [x] What does Expand mean once the panel resizes, and what min/max does Helm pass?
      `DockedPanel` defaults to 240/720, and today's expanded state is 75vw, so expand-to-max at
      the default cap would shrink the panel it replaces. Helm passes a max around 75vw, and
      Expand is a chrome-row toggle between the persisted width and that max, no longer resetting
      on close.
- [x] The docked region is not a dialog, so Kobalte's focus trap and Escape dismiss go away.
      Accepted: closing is the chrome button, and board.md §Screen layout already names a
      dialog's own Escape as the only keyboard behavior, which the panel no longer is.

## Run notes

- verify: `pnpm check` clean, 125 files, 0 errors
- verify: `pnpm build` completes with the geometry gate pre-step, 0 violations
- verify: live in Chrome against this repo board, dark theme. Panel docks beside the board with
  no scrim, the strip scrolls sideways at full column size, drag resize 800→824 persists through
  a reload, the splitter takes focus and arrow keys move it 8px a step, Expand jumps 824→1134
  (75vw) while localStorage keeps 824 and the state survives close/reopen, a shaping and a
  define selection each replace the card panel with exactly one `aside` in the DOM, a card
  drags Backlog→Refining→Backlog with the panel open, and the epic view renders beside it.
  Zero console errors across all of it.
- The fill-and-scroll criterion is unchecked: no chat session exists on this board, so every
  surface renders its empty state and the transcript + pinned composer could not be exercised.
  The layout chain (fill region → DrawerTabs → ScrollArea) was verified through the Brief tab at
  240px and 1134px; ChatPane itself is untouched by this story.
- At the 240px minimum the DrawerTabs list clips (Diff and History unreachable): the tab row has
  no overflow handling and never needed it at the overlay's fixed width. Pre-existing trait the
  resizable panel exposes; left for 004-05/004-06 territory rather than widened scope here.
- The gate verdict hash is stale against this file: the daemon rewrote frontmatter formatting
  (`runs: []`) and these run notes append after it. The verdict served its purpose pre-run.
- The card reached review from blocked, as 004-09 did: the work ran directly on master with no
  run record, and the daemon parks a running story it did not spawn. The exit to done is legal
  from review.
- review: approved at 11/12. The one unchecked criterion needs a live transcript, which this board
  cannot produce: it is carried into 004-05, whose brief owns `ChatPane` and must grade the panel's
  fill-and-scroll at both extremes with a real conversation in it.
- review: the 240px tab-row clipping is real and unowned by any card. 004-06 takes it, as the story
  that already opens the shared widget and chrome primitives.
