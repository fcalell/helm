---
id: 004-09
status: blocked
depends: []
sessions: {}
---
# Solid-ui contract migration

## Goal

`pnpm check` fails at HEAD with 67 TypeScript errors across 17 files in `src/app/components/`, and
every one is Helm calling a `@fcalell/plugin-solid-ui` component by a prop the component no longer
takes. The sibling `../stack` rebuilt seven component families onto its variant matrices: `Button`
and `Badge` replaced `variant` with `emphasis` plus `tone`, and `Textarea` dropped `size`. Helm
consumes the stack from the workspace, so the rebuild changed Helm's types with no Helm commit, and
the repo's one check command has been red ever since.

A red check command is worse than the sum of these errors. Every run self-tests with it, every
review grades `(command)` criteria from its output, and both are now blind: 005-07's run had to
report its check as failed on drift it did not cause, and its reviewer cannot tell a real regression
from this backlog. Nothing here is a behavior change, so the story is done when the errors are zero
and the rendered UI is unchanged.

The card is parked rather than backlogged because a second breaking change is already queued in
`../stack`. Story 001-05, the canon sweep, closes `class`, `className`, and `style` on all 60
components with no hatch in their place, and both of its dependencies are done, so it runs next.
Migrating Helm now fixes the prop rename and then re-breaks on the class removal. The parked
decision is to do one sweep against the settled API once 001-05 lands.

## Approach

Facts measured at Helm `f018419` and stack `0d1ac65`, both clean on master.

- The target API is settled. Stack 001-03 merged the solid-ui adoption at `b48ba43`, and no file
  under `plugins/solid-ui/src/` has changed since M3 closed at `d609a70`. The only edit in that
  range is `plugins/solid-ui/scripts/verify.ts`, extracted into the shared ui-core harness. Each
  family's mapping is documented in `plugins/solid-ui/docs/`.
- The 67 errors are 58 missing `variant`, 8 missing `size` (Badge, Input, Textarea, where the axis
  was removed outright), and 1 invalid `size="icon"` on Button at `expand-toggle.tsx:14`. The load
  concentrates in `proposal-widget.tsx` (22), `story-card.tsx` (7), `review-exits.tsx` (6) and
  `gate-panel.tsx` (6), with 13 files carrying four or fewer.
- Most values map cleanly: `ghost` to `emphasis="tertiary"`, `outline` and `secondary` to
  `emphasis="secondary"`, `destructive` to `tone="danger"`, and Badge's `destructive`, `warning`,
  `success` to `danger`, `warn`, `ok`.
- 24 call sites pass `class` to a solid-ui component, which is the 001-05 exposure: Button 6,
  Sheet 6, Loader 5, Badge 2, Tooltip 2, and one each on Tabs, DropdownMenu, Card. Two more pass a
  forwarded-class prop, `listClass` and `contentClass` at `card-drawer.tsx:251-252`.
- Two of those patterns repeat verbatim and belong in the components, not in Helm.
  `<Sheet.Content class="flex flex-col overflow-hidden">` with `<Sheet.Header class="shrink-0">`
  appears identically in all three drawers (`shaping-drawer.tsx:164`, `card-drawer.tsx:200`,
  `define-drawer.tsx:44`), which is Sheet failing to lay itself out. `<Loader class="text-xs">`
  appears identically five times (`activity-pane.tsx:193`, `card-drawer.tsx:137`,
  `diff-pane.tsx:194`, `gate-panel.tsx:203`, `chat-pane.tsx:198`), which is Loader missing a size
  axis. 001-05's own rule sends both to the component.
- Six sites are positional only (`self-end` at `board-header.tsx:107`, `new-epic-dialog.tsx:79`,
  `review-exits.tsx:222`; `self-start` at `proposal-widget.tsx:227` and with `ml-6` at
  `shaping-drawer.tsx:76`). These hoist onto a Helm-owned wrapper element and stay correct
  afterwards, since `?: never` closes the component's props and not Helm's own JSX.
- The rhythm family 001-05 names as the replacement does not exist yet. `Stack`, `Row`, and `Pair`
  are absent from `packages/ui-core/src/` (cn, derive, descriptors, emit, harness, schema, tokens,
  variants, variant-tables) and from solid-ui's component tree.

## Blast radius

`src/app/components/`, the 24 files importing `@fcalell/plugin-solid-ui`. No orchestrator, board,
session, or harness code. No behavior change: the rendered UI is unchanged when the story is done.

## Acceptance criteria

## Out of scope

## Open questions

- [ ] `Badge variant="outline"` has no equivalent. The new axis is `tone` alone, the matrix base is
      `rounded-full` with a fill, and `plugins/solid-ui/docs/badge.md` states there is no round prop
      and lists no bordered tone. Does Badge gain an emphasis axis in stack, or does Helm drop the
      outline treatment?
- [ ] `Button size="icon"` maps to `class="aspect-square"` per `plugins/solid-ui/docs/button.md:88`,
      the prop 001-05 removes. Helm hits this at `expand-toggle.tsx:13` (`ml-auto size-8`). What
      replaces the documented icon-only pattern once `class` is closed?
- [ ] Dropping `size="sm"` from Input and Textarea makes those controls visibly taller, since FIELD
      carries one control height as the tap floor. Is that accepted for Helm's dense drawers?
- [ ] 001-05's goal names `class`, `className`, and `style`, but solid-ui ships a parallel hatch
      family it does not mention: `contentClass` on 6 components, plus `listClass` and
      `containerClass`. If the sweep leaves them open the canon has a hole; if it closes them Helm's
      exposure grows past the 24 sites counted above. Raise in `../stack` before 001-05 runs.
- [ ] `answer-chip.tsx:16` forces Button to wrap as a chip
      (`h-auto min-w-0 max-w-full whitespace-normal text-left`). Is there a component for that, or
      does Helm own the element?
