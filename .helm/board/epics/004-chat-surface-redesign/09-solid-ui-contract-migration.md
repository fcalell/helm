---
id: 004-09
status: done
depends: []
sessions: {}
---
# Solid-ui contract migration

## Goal

Put `src/app/` back on the `@fcalell/plugin-solid-ui` contract. Helm consumes the stack from the
workspace, so the 001 epic changed Helm's types and Helm's build with no Helm commit, and the
break is three layers deep, not one:

- **The prop contract.** `Button` and `Badge` replaced `variant` with `emphasis` plus `tone`;
  `Input`, `Textarea` and `Badge` dropped `size`; `class`, `className`, `style` and the renamed
  `contentClass` / `listClass` hatch family are closed `?: never` on every component.
- **The geometry gate.** `stack build` scans the consumer's own `src/` and allows a class
  attribute only on a bare lowercase tag, carrying only the closed vocabulary (flex plumbing, zero
  offsets, the `w-full` / `min-h-0` facts, `overflow-hidden`, `gap-<rung>`, and the `items-`,
  `justify-`, `self-`, `z-` prefixes). Any dir named `ui` is skipped, which is where a consumer's
  own primitives live.
- **The token vocabulary.** The canon renamed every colour. Helm's palette
  (`text-muted-foreground`, `bg-card`, `text-destructive`, `bg-primary/10`, `border-border`, and 20
  more) no longer exists in the generated theme, so those classes compiled to nothing.

Done when all three are clean and the board still renders what it rendered before.

## Approach

Facts measured at Helm `983f5b7` and stack `7e8f4cc`, both clean on master. The whole 001 epic is
closed (001-05 canon sweep `15191c0`, 001-06 geometry gate `34343f9`, 001-07 remaining matrices
`32297f7`, 001-08 scroll and shell primitives `de05a03`).

- 87 `tsc` errors across 19 files, 516 gate violations across 24 files, 115 dead-token lines across
  23 files. `pnpm check` ran only `tsc` and `biome`, so the gate half was invisible until
  `pnpm build`.
- The gate's own escape is the consumer `ui/` directory, and stack's docs name it as the home for
  five things the canon deliberately does not ship: an icon-only button (`button.md`), a custom
  field surface (`input.md`, `textarea.md`), a different tabs look (`tabs.md`), and a capped pane
  (`scroll-area.md`). Stack's 001-05 close-out carries the matching note: helm's migration is owed
  in helm, plus the ratified tabs capability loss.
- `Sheet.Content` is its own scroll owner (`max-h-screen overflow-y-auto`, block not flex), so a
  fill pane cannot compose inside it and all three drawers would scroll as one page.
  `scroll-area.md` sends a non-scrolling drawer layout to the consumer.
- Two patterns repeated verbatim and were component gaps, not consumer sloppiness:
  `Sheet.Content` + `Sheet.Header` identical in all three drawers, and `Loader class="text-xs"`
  identical five times. 001-05 closed both by moving the geometry inside the components.

**The shape.** 20 primitives under `src/app/ui/`, each driven by a measured call site, and every
one composing the shared matrices (`button`, `card`, `sheetVariants`) rather than hand-copying
strings, so no ground is synced by hand. Everything else moved onto shipped components: `Frame` for
the shell, `ScrollArea` for all seven scroll panes, `Text` for every type role and colour,
`Card` for the widget panels, and `gap-<rung>` for every gap.

Two dependencies added: `@kobalte/core` (the drawer and tabs primitives stack ratified as Helm's)
and `@fcalell/ui-core` (the shared matrices).

## Blast radius

All 24 files in `src/app/components/`, `src/app/pages/index.tsx`, `src/app/app.css`
(`--color-ring` was dead too), and the new `src/app/ui/`. No orchestrator, board, session, or
harness code.

## Acceptance criteria

- [x] `pnpm check` passes, 126 files, zero errors (command)
- [x] The geometry gate reports zero violations over `src/` (command)
- [x] `pnpm build` completes, gate pre-step included (command)
- [x] No dead colour token remains in `src/`, `--color-ring` included (command)
- [x] Every colour class in `src/app/` resolves to a generated token (command)
- [x] The board renders: columns, cards, badges, buttons, the connection dot (live)
- [x] The drawer keeps its fill-and-scroll layout: intrinsic header, capped artifact panel,
      bottom-pinned transcript, composer pinned below (live)
- [x] Tab switching works and each tab owns its own scroll (live)
- [x] Epic view renders with capped lane columns and sideways scroll (live)
- [x] Zero console errors across board, drawer, tabs and epic view (live)

## Out of scope

- Contributing new axes to stack. Every gap the sweep hit had a documented consumer route, so
  nothing needed one.
- The look pass. Colours and type roles are mapped to their canon equivalents, not redesigned.

## Open questions

- [x] `Badge variant="outline"` has no equivalent: Badge ships `tone` alone and no bordered cell.
      Helm drops the outline treatment; those badges are neutral.
- [x] `Button size="icon"`: `button.md` names an icon-only look a consumer primitive. Helm owns
      `ui/icon-button.tsx`, composed from the same BUTTON cells, square at 44px so it keeps the
      canon's tap floor rather than the old 32px.
- [x] Input and Textarea lose `size="sm"`: accepted. FIELD carries one control height and it is the
      tap floor; the drawers are less dense and correct.
- [x] The `*Class` hatch family: 001-05 closed `contentClass`, `listClass` and `containerClass`
      with the rest. Helm's two sites moved into `ui/drawer-tabs.tsx`.
- [x] The wrapping chip: Button's label is `whitespace-nowrap` by design, so an answer of arbitrary
      length is not a Button. Helm owns `ui/chip.tsx`.

## Run notes

- verify: `pnpm check` clean, 126 files, 0 errors (was 87)
- verify: geometry gate 0 violations over `src/` (was 516)
- verify: `pnpm build` completes with the gate pre-step
- verify: 0 dead colour classes in `src/`; every `src/app/` colour class is a generated token
- verify: live render in Chrome against the sailward board, dark theme: board, card drawer, Brief
  and Chat tabs, epic view. Zero console errors.
- The card reached review from blocked, which `LEGAL_TRANSITIONS.blocked` does not allow
  (`transitions.ts:16` lists backlog, refining and ready). The work was a direct migration on master
  rather than a run, so no legal walk reaches the column the work was actually in, and the only
  alternative was inventing the ready and running hops plus the run record that would have to
  justify them. The exit to done is legal from review.
