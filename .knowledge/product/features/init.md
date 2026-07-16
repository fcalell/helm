# Init: onboarding a repo

Pointing Helm at a repo runs a guided init: Claude explores the repo, then proposes the files Helm
and the workflow need, each from a scaffold template ([templates](../../architecture/templates.md)).
Init is the define/refine pattern applied to the repo's own setup. An `init` session kind
investigates, proposals render as widgets, and accepting a widget writes the file
([define-refine](./define-refine.md) §Proposal widgets).

## What it scaffolds

- `.helm/` board structure, so the board exists before the first card
  ([board-storage](../../architecture/board-storage.md)).
- `.helm/CLAUDE.md`, Helm's rules for the repo, drafted from what the repo reveals (stack,
  conventions, entry points) over the canonical scaffold template, not a blank stub. A single
  `@.helm/CLAUDE.md` line is added to the repo's root `CLAUDE.md` (created if absent), the one write
  Helm makes outside `.helm/`.
- A **ubiquitous-language glossary** at `.helm/glossary.md`: the project's canonical terms, kept
  glossary-only (no implementation detail) and imported by `.helm/CLAUDE.md`, so chats and runs speak
  the repo's language concisely.
- `.helm/rules/` entries for the practices the repo should follow, imported by `.helm/CLAUDE.md`.
- `helm.config.json` registration (path and main branch) when the repo joins the hosted
  multi-repo daemon; `helm` run inside a repo needs none
  ([overview](../../architecture/overview.md) §Shape).

## How it works

1. **Explore first.** The `init` kind reads the repo and detects its stack and existing conventions
   ([session-kinds](../../architecture/session-kinds.md)), so the proposals fit the repo instead of a
   generic scaffold.
2. **Propose from templates.** Each file is proposed through `propose_scaffold` as a widget with
   accept/edit/reject; nothing is written until accepted, the single mutation path from a proposal
   Helm keeps everywhere ([define-refine](./define-refine.md) §Proposal widgets).
3. **Stays current afterward.** The scaffolded rules and `.helm/CLAUDE.md` are curated after init
   through the rules & knowledge library, so a repo tracks improving best practices without re-running
   init
   ([roadmap](../roadmap.md) §Later).
