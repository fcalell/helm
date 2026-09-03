# Documentation

> **Load when:** adding, editing, splitting, relocating, or deleting any doc.

## Which home

Three homes under `.helm/`, decided by what the doc **is**, not what it is about. Pick with the
test column, not by topic.

| The doc is…                                          | Home               | Test                                                     |
| ---------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| durable reference: what Helm is and why               | `.helm/knowledge/` | still true next year with no edit                        |
| a rule for how to build                               | `.helm/agents/`    | tells a session what to do, not what exists              |
| working evidence: measurements, plans, open findings  | `.helm/research/`  | dated, drains, or gets superseded                        |

A doc that fits two homes is two docs: the durable claim in `.helm/knowledge/`, the evidence behind
it in `.helm/research/`. Nothing hand-authored belongs at `.helm/` root, and nothing but the board
belongs under `.helm/board/`.

## Knowledge base

`.helm/knowledge/` describes *what Helm is and why* (product, architecture) as built. Keep it
current, and when the work shows a better shape than an entry records, propose it rather than
match the entry. Its index is imported into every session through
`.helm/agents/index.md`.

- Each entry is a standalone `.md` file in the right subfolder (`product/`, `architecture/`).
  Filename: `kebab-case-descriptive-name.md`. Entries are durable *what/why* reference, written
  present-tense ("how it works now"), not changelogs or build journals.
- **One topic per file; nest a folder when a domain has many.** Keep each file focused on a single
  topic so a session loads only what it needs (context optimization), and so links can target the
  exact topic. When a domain spans several topics, give it its own subfolder of small files
  (`product/features/`) instead of one monolith; split a file once it has grown into several
  loosely-related sections.
- Each file opens with a `# Title` and a one-paragraph summary. Factual and concise: reference
  material, dense for LLM consumption, not prose.
- **Cross-reference by relative file link or named anchor, never a section number.** Link to another
  entry with a relative path (`[runs](../product/features/runs.md)`); reference a section *within* a
  file by its heading name (`§Queue & rate limits`). **Never** cite a numbered section (`§9`):
  numbers break silently when content is added, removed, or reordered.
- **Always update `.helm/knowledge/index.md`** (the always-loaded navigation map) when adding,
  renaming, removing, or relocating an entry.
- Prefer **updating an existing entry** over creating a new one when topics overlap.
- **Decisions are recorded inline** in the doc they govern (product rationale in `product/`,
  architecture rationale in the relevant `architecture/` file), not as a separate dated ADR log.
  Revise rationale in place when it changes; don't leave stale parallel logs or dated history to
  pollute context.
- **Capture only what the code can't tell you**: invariants, the *why* behind non-obvious choices,
  gotchas, and designed-but-not-yet-built intent. Don't recite column lists, file trees, or
  dependency versions that mirror the source.
- When product behavior changes, update the relevant `product/features/` entry (and the matching
  `architecture/` entry if mechanics change) in the same commit as the code.

## Agent rules

`.helm/agents/` holds the how-to-build rules. `index.md` is the only file the root `CLAUDE.md`
imports, and it imports only the glossary and the knowledge index: every other rule doc is
pull-only, listed in the index's Rules table with the activity that should make a session read it.
Adding a rule doc means adding its row. Keep the glossary terms-only, so the standing context it
costs stays flat.

## Research

`.helm/research/` holds working evidence: experiment plans, measurement ledgers, and findings not
yet settled ([board-storage](../knowledge/architecture/board-storage.md) §Research).

- **Update `.helm/research/index.md`** on any add, rename, remove, or relocate.
- **One folder per experiment**, holding its plan and the ledgers of the sessions it spent. The
  second file sharing a prefix is the trigger to create the folder.
- **Promote, then keep or delete.** When a finding settles, fold the conclusion into the
  `.helm/knowledge/` entry it governs. The research doc then stays as the evidence behind that
  entry, or is deleted once nothing cites it.
- **Delete a drained doc.** A triage list with nothing left to triage is git history, not a file.
- **Never commit raw session data.** Transcripts are reproducible from `~/.claude/projects/` and
  the ledgers are their distilled form; gitignore them.

## Filing findings

When a session turns up something durable (a platform/library gotcha, a Claude Code CLI behavior, a
debugging discovery, a design or architecture decision reached in chat), record it rather than
leaving it to evaporate in conversation: settled facts go to `.helm/knowledge/`, evidence that
still needs weighing goes to `.helm/research/`.
