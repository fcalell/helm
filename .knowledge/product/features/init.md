# Init: onboarding a repo

Pointing Helm at a repo runs a guided init: Claude explores the repo, then proposes the files Helm
and the workflow need, each from a scaffold template ([templates](../../architecture/templates.md)).
Init is the define/refine pattern applied to the repo's own setup. An `init` session kind
investigates, proposals render as widgets, and accepting a widget writes the file
([define-refine](./define-refine.md) §Proposal widgets).

## What it scaffolds

- `.helm/` board structure, so the board exists before the first card
  ([board-storage](../../architecture/board-storage.md)).
- `.helm/agents/index.md`, the single entry point for Helm's rules, drafted from what the repo
  reveals (stack, conventions, entry points) over the canonical scaffold template, not a blank stub.
  A single `@.helm/agents/index.md` line is added to the repo's root `CLAUDE.md` (created if absent),
  the one write Helm makes outside `.helm/`, so the repo keeps just one file named `CLAUDE.md`.
- `.helm/agents/` rule docs for the practices the repo should follow, plus a **ubiquitous-language
  glossary** (`.helm/agents/glossary.md`) kept glossary-only (no implementation detail); `index.md`
  imports them, so chats and runs speak the repo's language concisely.
- `.helm/knowledge/`, the repo's knowledge base (what/why docs) with its own navigation index, pulled
  on demand rather than loaded every session.
- The per-repo run config: the Auto-preset allowlist override and the repo's test commands,
  proposed from the detected stack ([runs](./runs.md) §Permission presets).
- `helm.config.json` registration (path and main branch) when the repo joins the hosted
  multi-repo daemon; `helm` run inside a repo needs none
  ([overview](../../architecture/overview.md) §Shape).

## How it works

1. **Explore first.** The `init` kind reads the repo and detects its stack, conventions, and any
   agent rules already in place ([session-kinds](../../architecture/session-kinds.md)), so the
   proposals fit the repo (§Migrating an existing repo) instead of a generic scaffold.
2. **Propose from templates.** Each file is proposed through `propose_scaffold` as a widget with
   accept/edit/reject; nothing is written until accepted, the single mutation path from a proposal
   Helm keeps everywhere ([define-refine](./define-refine.md) §Proposal widgets).
3. **Stays current afterward.** The scaffolded `.helm/agents/` rules and `.helm/knowledge/` docs are
   curated after init through the rules & knowledge library, so a repo tracks improving best practices
   without re-running init
   ([roadmap](../roadmap.md) §Later).

## Migrating an existing repo

Dropped into a repo that already has agent rules (a root `CLAUDE.md`, `.claude/rules/`, `AGENTS.md`, a
`CONTEXT.md`, `docs/`), init reconciles instead of duplicating. It avoids two failures: restating
rules that already load (the root `CLAUDE.md` auto-loads, so a copy under `.helm/agents/` would load
them twice) and growing the context every run inherits.

- **Reference, never restate.** `.helm/agents/index.md` adds only Helm's board rules and points at
  the existing rules as the repo's canonical set, never copying loaded content. This alone keeps init
  non-duplicating, and it is the whole behavior if the user accepts nothing more.
- **Consolidate on offer.** Init proposes folding the existing sprawl into `.helm/`: deduped rules
  under `.helm/agents/`, and the move that pays off, reference material (rationale, background,
  rarely-needed detail) shifted off the always-loaded path into `.helm/knowledge/`, pulled on demand.
  The root `CLAUDE.md` slims to its essentials plus the import, so per-session context shrinks.
- **Reversible and opt-in.** Every move is a proposal widget (accept/edit/reject per file) that lands
  in git; nothing is auto-deleted, and declining leaves init purely additive.
- **A visible number.** Init reports the standing context (the tokens that load every session) before
  and after, so the trade is measured, not guessed. That standing-context meter is a permanent
  read-only view in the UI ([board](./board.md) §Screen layout), the first slice of managing rules and
  knowledge from Helm.

Re-running init on a repo that already has `.helm/` fills gaps rather than migrating again.
