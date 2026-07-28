# Helm

Helm is a self-hosted kanban orchestrator for Claude Code workflows. Epics and stories are shaped in
conversation with Claude, refined into implementation briefs, executed as headless Claude Code runs
in git worktrees, and reviewed against their own acceptance criteria. It wraps the user's locally
authenticated `claude` CLI, so it runs on a Claude Max subscription with no API billing. **UI and
code are English.**

**Pre-product stage.** The spec lives in `.helm/knowledge/`; the code layout is the **Today**
bullet below. Helm manages itself: this repo is a managed repo, and its `.helm/` is the reference
instance of the layout Helm scaffolds
([board-storage](./.helm/knowledge/architecture/board-storage.md)).

@.helm/agents/index.md

## Where things are

- **Today**: `.helm/knowledge/` (product + architecture spec), `.helm/agents/` (rules + glossary),
  `.helm/research/` (working evidence: experiments, ledgers, findings), `.helm/board/` (this repo's
  own board), `src/board/` (the `.helm/` storage + watcher module), `src/sessions/` (the kind
  registry + headless `claude` runner, `.helm/knowledge/architecture/session-kinds.md`),
  `src/worker/` (oRPC routes, `.helm/knowledge/architecture/api.md`), `src/server/` (managed-repo
  config + the board and session services that broadcast over WS), `src/shared/` (the WS channel
  contract), `src/app/` (the SolidJS board UI), `helm.config.json` (gitignored machine paths;
  committed example), `spikes/` (throwaway reference scripts, one folder per spike).
- **Shape** (detail in `.helm/knowledge/architecture/overview.md`): a Node/TypeScript
  orchestrator that spawns headless `claude` sessions and exposes HTTP + WebSocket; a web UI as
  its first client; boards stored as markdown under each target repo's `.helm/`. No database.
  Built as a `@fcalell/stack` consumer (SolidJS UI); the stack lives in the sibling `../stack`
  repo and gets improved as Helm needs, never worked around. **No tests in this repo**; stack
  changes follow `../stack`'s own rules.
