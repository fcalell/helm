# Templates

Every artifact Helm generates is stamped from a template, never written from a blank page. Templates
carry the best practices, so improving one lifts every future artifact at once. That is what makes
the workflow predictable and lets it compound as new practices are found
([vision](../product/vision.md) §Principles). A template pairs with the session kind that fills it:
the kind's prompt says "fill this template", the template is the output shape
([session-kinds](./session-kinds.md)).

## Two kinds of template

- **Generation templates** shape a repeatedly-produced artifact: the brief, an epic, a story card, a
  shaping doc, the adversary report, the review report. Each output is stamped from the current
  version and lands in `.helm/` as a filled artifact; the template itself is never copied into the
  repo. A generation template improves freely, and the next artifact picks up the improvement with no
  migration.
- **Scaffold templates** produce a one-time repo file at onboarding: `.helm/agents/index.md` (Helm's
  rules entry point), its glossary and rule docs, the `.helm/knowledge/` base, and the `.helm/board/`
  structure, plus the single `@.helm/agents/index.md` import added to the repo's root `CLAUDE.md`.
  Init writes concrete files
  from them into the repo, where they are git-versioned and hand-editable
  ([init](../product/features/init.md)). They stay current afterward through the rules & knowledge
  library's import-and-override model ([roadmap](../product/roadmap.md) §Later).

## Canonical with per-repo override

Generation templates ship with Helm as the canonical set, so a fresh repo gets the current best
practice with no setup. Later they are curated in the central library alongside shared rules
([roadmap](../product/roadmap.md) §Later). A repo overrides one by placing its own version under
`.helm/templates/`; the override wins for that repo and the rest stay canonical, so improvements to
the untouched templates still propagate. This is the shared-with-local-override model the rules &
knowledge library uses for rules, applied to templates.
