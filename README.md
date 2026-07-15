# Helm

A self-hosted kanban board that orchestrates Claude Code. Epics and stories are shaped in
conversation with Claude, refined into implementation briefs, executed as headless Claude Code runs
in git worktrees, and reviewed against their own acceptance criteria. Helm wraps the locally
authenticated `claude` CLI, so it runs on a Claude Max subscription with no API billing.

**Status: spec only.** No code yet. The product and architecture spec lives in
[`.knowledge/`](./.knowledge/index.md); the build order is in
[`.knowledge/product/roadmap.md`](./.knowledge/product/roadmap.md).
