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

`.helm/knowledge/` follows the global knowledge rule (`~/.claude/rules/knowledge.md`, loaded on
first read of an entry). Its index is imported into every session through `.helm/agents/index.md`.
When product behaviour changes, the `product/features/` entry and, when mechanics change, the
matching `architecture/` entry move in the same commit as the code.

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
