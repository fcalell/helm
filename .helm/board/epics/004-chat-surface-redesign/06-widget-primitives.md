---
id: 004-06
status: backlog
depends: [004-02]
sessions: {}
---
# Widget primitives

## Goal

The bespoke widget styling collapses into shared components. `WidgetShell` replaces the five
copies of the bordered shell class string (`proposal-widget.tsx`, `decision-widget.tsx`,
`question-widget.tsx`, `question-group.tsx`, `run-question-panel.tsx`), `Eyebrow` replaces the
nine copies of the uppercase label, and `AnswerChip` replaces the hand-rolled `Button` chips in
`run-question-panel.tsx:46-61`, which currently miss its wrapping fix. `ChecklistSection` and
`BriefView` move out of `card-drawer.tsx` into their own module (`diff-pane.tsx` imports them
from the drawer today), and `StoryCard`'s inert `gap-2` on the stack `Card` gets a working
spacing treatment.
