# Init: onboarding a repo

Pointing Helm at a repo runs a guided init: Claude explores the repo, then proposes the files Helm
and the workflow need, each from a scaffold template ([templates](../../architecture/templates.md)).
Init is the define/refine pattern applied to the repo's own setup. An `init` session kind
investigates, proposals render as widgets, and accepting a widget writes the file
([define-refine](./define-refine.md) §Proposal widgets).

## What it scaffolds

- `.helm/` board structure, so the board exists before the first card
  ([board-storage](../../architecture/board-storage.md)).
- `CLAUDE.md`, drafted from what the repo reveals (stack, conventions, entry points) over the
  canonical scaffold template, not a blank stub.
- A **ubiquitous-language glossary**: the project's canonical terms, kept glossary-only (no
  implementation detail), loaded every session (a `.claude/rules/` entry) so chats and runs speak the
  repo's language concisely.
- `.claude/rules/` entries for the practices the repo should follow.
- `helm.config.json` registration: path and main branch
  ([overview](../../architecture/overview.md)).

## How it works

1. **Explore first.** The `init` kind reads the repo and detects its stack and existing conventions
   ([session-kinds](../../architecture/session-kinds.md)), so the proposals fit the repo instead of a
   generic scaffold.
2. **Propose from templates.** Each file is proposed through `propose_scaffold` as a widget with
   accept/edit/reject; nothing is written until accepted, the single mutation path from a proposal
   Helm keeps everywhere ([define-refine](./define-refine.md) §Proposal widgets).
3. **Stays current afterward.** Scaffolded rules and `CLAUDE.md` are curated after init through the
   rules & knowledge library, so a repo tracks improving best practices without re-running init
   ([roadmap](../roadmap.md) §Later).
