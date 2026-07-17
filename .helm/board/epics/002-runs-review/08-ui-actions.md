---
id: 002-08
status: refining
depends: []
branch: helm/002-08-ui-actions
sessions: {}
---
# UI actions & hotkey removal

## Goal

Every board action is a visible control and the app-level hotkey layer is gone: each card carries
one status-driven action button, the header carries the board-level entries, and the design flips
from keyboard-first to button-first (`.knowledge/product/features/board.md` §Screen layout). The
only keyboard behavior left is native focus activation. Retrofits the `n`/`r` keys 001-04/05 land
as briefed.

## Approach

- Delete the global `keydown` listener in `src/app/pages/index.tsx` (`j/k` selection, `e` toggle,
  `Enter`, `Escape`) and the `n`/`r` bindings 001-04/05 add. Element-level behavior stays: the
  focused card's Enter/Space activation (`story-card.tsx`, its `role="button"` accessibility) and
  the drawer component's own dismiss.
- Collapse the selection machinery to what the drawer needs: `j/k` browsing was the only reason a
  card could be selected but closed, so click-selects-and-opens becomes the whole model. Drop
  whatever the simplification orphans (the selected ring, the `scrollIntoView` effect).
- Header (`board-header.tsx`): an epic-view toggle button replacing `e`, and a **New epic** button
  opening the same title-plus-paragraph define entry the `n` key opened (001-04's flow). The Shape
  entry is already header UI from 001-04; align it with the new buttons.
- Card (`story-card.tsx`): one status-driven action button. Backlog → **Refine** (what 001-05's
  `r` did: open the drawer chat and start or resume the refine session); Refining → reopen its
  chat. Later statuses get their action from their own story (Ready's Run button lands with
  002-01 on this pattern). The button stops propagation so it never double-fires the card's
  open-click.
- Spec docs already carry the button-first design (updated with this decision); this story is
  code-only.

## Blast radius

`src/app` only: `pages/index.tsx`, `components/board-header.tsx`, `components/story-card.tsx`,
and the entry points 001-04/05 add under `src/app`. No server, worker, or board-module changes.

## Acceptance criteria

- [ ] No global keydown listener remains: with nothing focused, pressing `j`, `k`, `e`, `n`, `r`,
  `Enter`, or `Escape` changes nothing on the board.
- [ ] A focused card still activates with Enter and Space.
- [ ] The header shows an epic-view toggle button that switches the swimlane view and reflects its
  state.
- [ ] The header shows a New epic button that opens the define entry the `n` key opened.
- [ ] A Backlog card shows a Refine action that opens the drawer chat and starts or resumes the
  refine session; a Refining card's action reopens its chat.
- [ ] Clicking a card's action button does not also trigger the card's open-click.
- [ ] The open drawer still closes through its own dismiss affordances (close control, overlay,
  the component's Escape handling).

## Out of scope

- The Run button on Ready cards: 002-01 builds it on this card-action pattern.
- The mobile surface and drag-and-drop, both unchanged.
- Chat-composer keys (Enter-to-send is composer-local) and slash shortcuts (typed chat commands,
  not hotkeys).

## Open questions

- [x] Removal scope: the whole global layer goes; element-level accessibility stays.
- [x] Replacement: status-driven card action button plus header buttons.
- [x] Command palette: dropped from the design; a palette is a keyboard surface.
- [x] Sequencing: 001-04/05 land their keys as briefed; this story retrofits, first in execution
  once epic 1 finishes.
