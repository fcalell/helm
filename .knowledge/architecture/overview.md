# Architecture overview

Helm is a **local orchestrator wrapping the headless `claude` CLI**. No Agent SDK, no API key: the
CLI carries the user's Max subscription auth, which is the constraint the whole design serves
([vision](../product/vision.md), mechanics in [claude-integration](./claude-integration.md)).

```
PWA: React board + chat panes + diff viewer
        │ HTTP + WebSocket
Node/TypeScript orchestrator (the only server process)
  ├─ spawns `claude -p --output-format stream-json --resume …` per chat turn / run
  ├─ in-process MCP server exposing board tools to chat sessions
  ├─ git: worktree + branch lifecycle per story, merge/PR on approve
  ├─ queue: concurrency cap + rate-limit accounting
  └─ watches .helm/**/*.md in target repos; pushes changes over WS
```

## Shape

- **API-first**: the orchestrator is a clean HTTP/WS API; the web UI is its first client, not its
  body. Later clients (a CLI, notification actions) cost nothing extra.
- **No database.** State is the `.helm/` markdown files in each target repo
  ([board-storage](./board-storage.md)) plus Claude Code's own session transcripts. The
  orchestrator holds only ephemeral runtime state (live processes, queue, WS subscriptions) and
  rebuilds it from disk on restart.
- **One machine.** Orchestrator, `claude` CLI, target repos, and worktrees are colocated; remote
  access is a network concern, not an architecture concern ([deployment](./deployment.md)).
- **Stack intent**: Node + TypeScript, React for the UI. Library choices (server framework,
  bundler, WS) are made at the first code milestone against current docs, then recorded here.

## Top-level constraints

- **Concurrency is rate-limit-bound, not CPU-bound.** The Max 5-hour window + weekly cap are a
  pool shared with the user's interactive sessions; the queue exists to protect that pool
  ([runs](../product/features/runs.md) §Queue).
- **Chat never mutates board files; accepted proposals do.** The UI writing files on accept is the
  single mutation path from conversation ([define-refine](../product/features/define-refine.md)).
- **The UI is remote-code-execution on the host** by nature (runs execute shell commands).
  Exposure and privilege rules in [deployment](./deployment.md) are load-bearing, not hygiene.
