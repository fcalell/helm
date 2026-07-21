---
id: 002-08
status: done
depends: []
branch: helm/002-08-ui-actions
gate: { passed: 2026-07-21T06:05:30.000Z, brief: ea1c3d3b49b8cc35, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: 62a60c44-6ed1-4e0e-b818-f9432c6e6168, brief: ea1c3d3b49b8cc35, started: 2026-07-21T06:07:00.000Z, outcome: review, grades: 10/10, tokens: 209576, minutes: 20.7 }
---
# UI actions & hotkey removal

## Goal

Every board action is a visible control and the app-level hotkey layer is gone: each card carries
one status-driven action button, the header carries the board-level entries, and the only keyboard
behavior left is native focus activation plus the drawer's own dismiss
(`.knowledge/product/features/board.md` §Screen layout). The action set includes **Ready → Run**:
the original plan had 002-08 execute first and 002-01 build its Run entry on this pattern, but
002-01 shipped without one, so today `run.start` has no UI caller at all and this story, the
epic's last, closes that gap.

## Approach

Facts, verified against the tree at `7ba939c`:

- The global hotkey layer is `handleKeydown` in `src/app/pages/index.tsx` (~98-142, window
  listener mounted at ~137): `e` toggles `epicView`, `n` opens `NewEpicDialog`, `Escape` closes
  the drawer, `r` calls `refineSelected`, `Enter` opens the selected card, `j`/`k` walk
  `flatStoryOrder()`. Its support code: `isTypingTarget` (~28-35), `flatStoryOrder` (~79-96), and
  a `scrollIntoView` effect on selection (~144-150).
- `refineSelected` (~63-77) opens the drawer on the `chat` tab and calls `spawnRefineSession`
  only when `status === "backlog" && sessions.refine === undefined`; `spawnRefineSession`
  (`src/app/lib/session-store.ts:492`) tracks `refineSpawns` and toasts its own errors.
- Selection threads as props: `selectedStoryId`/`onSelect` flow index → `BoardGrid`
  (`board-grid.tsx:25-26`) → `BoardColumn` (~48-50) and `EpicLane` (~50-52) → `StoryCard`, which
  renders a `selected` ring (`story-card.tsx:168`). `openStory` (index ~57-61) already does
  select-plus-open; the drawer reads `selectedStoryId` and closes through its `Sheet`
  (overlay, close control, Kobalte's own Escape handling).
- The card root is the drag, click, and keyboard surface: `role="button"` with an Enter/Space
  activation handler (`story-card.tsx:159-165`) and solid-dnd `dragActivators` on pointerdown.
  `PermissionPrompt` (~94-102) is the precedent for nested controls: it stops `pointerdown`,
  `click`, and `keydown` propagation so none of the three paths fire.
- The header (`board-header.tsx`) renders `ShapeEntry`, `QueueStatus`, `RateMeter`; no epic-view
  or New epic control exists. `epicView` and the `NewEpicDialog` open signal live in index
  (~43, ~50).
- `run.start` (`src/worker/routes/run.ts:20-22`) → `startRun`, returning
  `{ sessionId } | { queued: true }` (`runs.ts:330`); with a free slot it resolves after the card
  reads `running` on disk. `story.move` refuses `to: "running"` (route ~31-39), so a Run button is
  the only legal UI path into Running. Queue occupancy streams on the meter channel:
  `meterStore.snapshot.queue.{running,queued}` with entries `{ kind, storyId? }`
  (`src/shared/meter.ts:9-18`); `dequeueRun` (session-store ~352) backs the header chip's cancel.
- `defaultTab` (`card-drawer.tsx:34-39`): refining → chat, running → activity, review → diff.
- The docs already state the button-first design as current (`board.md` §Screen layout,
  `roadmap.md`); this story is code-only.

Build on those anchors, all inside `src/app`:

**Delete the hotkey layer and the selection machinery it justified.** Remove `handleKeydown`, the
window listener wiring, `isTypingTarget`, `flatStoryOrder`, and the `scrollIntoView` effect from
`index.tsx`. Click-selects-and-opens (`openStory`) becomes the whole model: drop the
`selectedStoryId`/`onSelect` props from `BoardGrid`, `BoardColumn`, `EpicLane`, and `StoryCard`
along with the `selected` ring; the `selectedStoryId` signal stays in index as the drawer's story
source, set only by `openStory`. Element-level behavior stays: the card's Enter/Space activation
and the drawer Sheet's own dismiss.

**Header buttons.** `BoardHeader` gains `epicView: boolean`, `onToggleEpicView`, and `onNewEpic`
props, rendered as two buttons beside Shape: an epic-view toggle carrying `aria-pressed` and a
pressed-state variant so it reflects state, and **New epic** opening the same `NewEpicDialog`
flow `n` opened (dialog and `onCreated` wiring in index are unchanged).

**Card action button.** `StoryCard` renders one status-driven button (footer row of the card),
with `pointerdown`/`click`/`keydown` propagation stopped the `PermissionPrompt` way so it never
drags the card or double-fires the card's open-click, including keyboard activation on the
button. The status map, everything else rendering no button: Backlog → **Refine** and
Refining → **Chat**, both through one threaded `onRefine(id)` callback (grid → column/lane →
card) that index serves with the current `refineSelected` logic hoisted to take a story id
(open on `chat`, spawn only for backlog without `sessions.refine`); Ready → **Run**, calling a
new session-store helper `startStoryRun(storyId)` that wraps `api.run.start` and toasts
rejections. The Run button disables while the call is in flight and renders a disabled
**Queued** label while the story sits in the meter queue
(`queue.queued` entry with `kind: "run"` and its `storyId`); the header chip keeps the cancel.

## Blast radius

`src/app` only: `pages/index.tsx`, `components/board-header.tsx`, `story-card.tsx`,
`board-grid.tsx`, `board-column.tsx`, `epic-lane.tsx`, `lib/session-store.ts` (the
`startStoryRun` helper). No server, worker, board-module, or doc changes.

## Acceptance criteria

- [ ] No global key listener remains in `src/app`: with focus on `document.body`, pressing `j`,
      `k`, `e`, `n`, `r`, `Enter`, or `Escape` changes nothing (no selection, view toggle,
      dialog, or drawer movement).
- [ ] A focused card still opens its drawer with Enter and with Space, and Space does not scroll
      the board.
- [ ] The header shows an epic-view toggle that switches the swimlane view and reflects its state
      via `aria-pressed`, and a New epic button that opens the dialog the `n` key opened, with a
      created epic still landing in its define drawer.
- [ ] A Backlog card's Refine action opens the drawer on the chat tab and spawns the refine
      session only when `sessions.refine` is unset; a Refining card's Chat action reopens its
      chat with no new spawn.
- [ ] A Ready card's Run action calls `run.start`: with the slot free the card flips to Running
      through the board snapshot; with the slot held the entry queues, the button reads Queued
      and stays disabled while the story is in the meter queue, and a rejected start toasts the
      error.
- [ ] Activating a card's action button (mouse or keyboard) never also opens the drawer through
      the card's own click, and never starts a drag.
- [ ] Cards in running, review, needs-input, blocked, and done show no action button.
- [ ] The selection machinery is gone: no `selected` ring, no `scrollIntoView` effect, and no
      `selectedStoryId`/`onSelect` props on `BoardGrid`, `BoardColumn`, `EpicLane`, or
      `StoryCard`; the drawer still shows the clicked story.
- [ ] The open drawer still closes through its close control, overlay click, and its own Escape
      handling.
- [ ] `pnpm check` passes.

## Out of scope

- The mobile surface and drag-and-drop behavior, both unchanged.
- Chat-composer keys (Enter-to-send is composer-local) and slash shortcuts.
- Actions for running, review, needs-input, blocked, or done cards: steering, exits, and answers
  already live in the drawer and card panels; the drawer's `defaultTab` routes them.
- Run presets or any `run.start` input beyond the story id (the preset picker lives in the
  drawer).
- Server, worker, and board-module changes; doc edits (board.md and roadmap.md already carry the
  design).

## Open questions

- [x] Removal scope: the whole global layer goes; element-level accessibility stays.
- [x] Replacement: status-driven card action button plus header buttons.
- [x] Command palette: dropped from the design; a palette is a keyboard surface.
- [x] Run entry ownership: 002-01 shipped without the Run button, so it lands here rather than
      staying deferred to a closed story.
