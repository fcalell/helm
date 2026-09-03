# Helm agent rules

The single entry point for Helm's rules, imported by the repo's root `CLAUDE.md`. It loads the
glossary and the knowledge-base navigation map; nothing below the two imports auto-loads.

@glossary.md
@../knowledge/index.md

`.helm/knowledge/` (mapped by the index above) describes *what Helm is and why* as built: product
and architecture, each entry the best shape known when it was written, not a verdict.
`.helm/agents/` holds the how-to-build rules. `.helm/research/` holds working evidence
(experiments, ledgers, findings) not yet settled into knowledge. **Pull a doc the moment your task
matches it; never pre-read the whole base.**

Claude Code CLI behavior (flags, auth, session format) changes fast: re-verify against current
docs before building on it.

## Rules: pull the playbook before you act

Before starting an activity below, **read the listed doc(s)**, don't write in a domain without
loading its rules, and read only what the task needs.

| About to…                                      | Read                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| edit/create any TypeScript                     | `.helm/agents/conventions.md` (TS · Biome · naming · comments · errors)                 |
| write any prose (docs · KB · commit/PR bodies) | `.helm/agents/writing-style.md`                                                         |
| write or move any doc                          | `.helm/agents/docs.md` (which of the three homes it belongs in, and that home's rules)  |
