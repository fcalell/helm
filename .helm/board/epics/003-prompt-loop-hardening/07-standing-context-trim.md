---
id: 003-07
status: backlog
depends: []
sessions: {}
---
# Standing-context trim

## Goal

The auto-loaded import chain (root CLAUDE.md, `.helm/agents/index.md`, glossary, knowledge index)
gets a lean pass: it rides every session including each cold gate pass, suppression is closed
under subscription auth (claude-integration.md §Invocation model), and the chain grew ~40% since
the P1 measurement (10,114 → 14,140 chars). The pass cuts restatement and prose weight without
dropping a rule, and re-measures with the capture probe to record the saving.
