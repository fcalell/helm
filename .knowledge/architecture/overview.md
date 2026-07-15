# Architecture overview

Helm is a **local orchestrator wrapping the headless `claude` CLI**. No Agent SDK, no API key: the
CLI carries the user's Max subscription auth, which is the constraint the whole design serves
([vision](../product/vision.md), mechanics in [claude-integration](./claude-integration.md)).

```
PWA: SolidJS board + chat panes + diff viewer
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
  rebuilds it from disk on restart, reconciling as it goes: a Running card with no live process
  (crash, kill, missed hook) resumes its session or parks in Blocked.
- **One machine.** Orchestrator, `claude` CLI, target repos, and worktrees are colocated; remote
  access is a network concern, not an architecture concern ([deployment](./deployment.md)).
- **Stack**: Node + TypeScript, pnpm. Helm is a consumer of `@fcalell/stack`, the author's
  plugin-driven framework in the sibling `../stack` repo, consumed via `link:` dependencies while
  both evolve: `plugin-api` (Hono + oRPC procedures, typed client, Zod), `plugin-solid` +
  `plugin-solid-ui` (SolidJS, Kobalte + Tailwind v4 components, TanStack solid-query),
  `plugin-vite`, and `plugin-node` (the long-running Node target via `@hono/node-server`: serves
  the API worker, the built SPA, background services registered from `src/server/services/`, and
  the typed WebSocket surface, all on one port; dev is same-origin through a vite proxy).
  Capabilities Helm needs that the stack lacks are built in the stack, never worked around in
  Helm. A PWA option follows with the mobile surface (v2).
- **No build step.** Node ≥ 24 runs the orchestrator's TypeScript directly (type stripping); node
  itself rejects non-strippable syntax at boot, and `tsc --noEmit` + Biome are the `pnpm check`
  gate. (`erasableSyntaxOnly` can't live in the tsconfig: the program includes linked stack
  sources whose CLI-side code is legitimately non-erasable.) Local imports carry explicit `.ts`
  extensions; the SPA is the one built artifact (`stack build` → `dist/client`).
- **Helm-side libraries**: chokidar for the `.helm/` watcher (v4 dropped glob support: watch the
  directory, filter paths in the handler); `yaml` plus a hand-rolled fence
  splitter (Zod-validated, fixed key order for stable git diffs) for story files; git by shelling
  out to the binary (worktrees and rebase plumbing are first-class there); CodeMirror merge view
  for the review diff. Managed repos are registered in a config file (path + main branch), never
  auto-discovered.
- **No test suite in Helm.** Stack changes land in `../stack` and follow that repo's testing
  rules.

## Top-level constraints

- **Concurrency is rate-limit-bound, not CPU-bound.** The Max 5-hour window + weekly cap are a
  pool shared with the user's interactive sessions; the queue exists to protect that pool
  ([runs](../product/features/runs.md) §Queue).
- **The orchestrator is the only writer of `.helm/`.** Chat mutates nothing until a proposal is
  accepted ([define-refine](../product/features/define-refine.md)); runs update their card through
  board tools; hooks POST events instead of editing files
  ([board-storage](./board-storage.md) §Mutation rules).
- **The UI is remote-code-execution on the host** by nature (runs execute shell commands).
  Exposure and privilege rules in [deployment](./deployment.md) are load-bearing, not hygiene.
