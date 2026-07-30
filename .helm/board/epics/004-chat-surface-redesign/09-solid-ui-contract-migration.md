---
id: 004-09
status: backlog
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
the repo's one check command has been red ever since. 58 of the errors are `Property 'variant'` and
8 are `Property 'size'`; the load is concentrated in `proposal-widget.tsx` (22), `story-card.tsx`
(7), `review-exits.tsx` (6) and `gate-panel.tsx` (6), with 13 files carrying four or fewer.

A red check command is worse than the sum of these errors. Every run self-tests with it, every
review grades `(command)` criteria from its output, and both are now blind: 005-07's run had to
report its check as failed on drift it did not cause, and its reviewer cannot tell a real regression
from this backlog. Nothing here is a behavior change, so the story is done when the errors are zero
and the rendered UI is unchanged.

The work is a per-call-site mapping decision, not a rename. `variant="destructive"` becomes a
`tone`, `variant="ghost"` an `emphasis`, and some call sites carry a `variant` that splits into
both, so a blind find-and-replace would silently restyle the board. The stack's own component docs
are the source of truth for each mapping, and `../stack` is a sibling repo with its own rules: read
them before assuming a mapping, and if a Helm call site has no clean equivalent, that is a gap to
raise in `../stack` rather than to work around here.
