# Harness feasibility

Three unknowns story 005-05 (the zero-cost gate harness) rested on, measured instead of assumed.
Run on node v24.18.0, against `cbd6844`.

## 1. MCP SDK client against the product's `@hono/mcp` server — works

`mcp-client.ts` mirrors `src/server/services/mcp.ts:18-26` exactly (token lookup, fresh
`McpServer` + `StreamableHTTPTransport` per request, no session id) and drives it with
`@modelcontextprotocol/sdk`'s `Client` + `StreamableHTTPClientTransport`.

```
connected; tools: [ 'flag_risk' ]
call 1: [{"type":"text","text":"recorded"}]
call 2 (fresh server instance): [{"type":"text","text":"recorded"}]
invalid payload -> resolved isError=true [{"type":"text","text":"MCP error -32602: Input validation error…
handler received: [ 'F1', 'F2' ]
```

Two findings, the second load-bearing for the stub's design:

- A client that initialized against one per-request server instance keeps working across later
  instances: `initialize` and each `tools/call` are independent requests, so the stateless route
  needs no session affinity.
- **A rejected tool call resolves with `isError: true`, it does not throw.** A stub that splits
  retryable refusals from fatal ones must read `result.isError` and the text, never `catch`.

## 2. Scratch cwd with a symlinked `dist/client` — works

`scratch-cwd.ts`. `loadManagedRepo` reads `helm.config.json` relative to the process cwd
(`src/server/config.ts:20,26`) while `.stack/server.ts` hardcodes `staticRoot: "dist/client"`,
which `serveStatic({ root })` also resolves from cwd
(`../stack/plugins/node/src/server/create-node-server.ts:53,115`) — so starting the orchestrator
from a scratch directory isolates the config but loses the SPA. A `dist/client` symlink in the
scratch cwd restores it:

```
cwd: /private/tmp/helm-harness-spike
helm.config.json from cwd: {"repos":[{"path":"/tmp/helm-harness-spike/repo",…
GET / -> 200 <!doctype html><title>scratch spa</title>
```

So a harness never has to swap the developer's gitignored `helm.config.json` (what
`spikes/permission-live` did), and UI checks stay available on the scratch app.

## 3. An extensionless ESM `claude` shim importing a `.ts` sibling — works

`shim/claude` (`#!/usr/bin/env node`, `+x`, no extension) imports `shim/impl.ts`, which carries
type annotations. Spawned the way the orchestrator spawns it (`spawn("claude", args)` with the
shim's directory on `PATH`, `src/sessions/runner.ts:183`):

```
exit 0 stdout: {"loaded":"ts-sibling","label":"--model"}
```

Node loads the extensionless entry as ESM and strips types through the import, so the executable
stays three lines of JS while `tsc` covers the implementation.

## Also found: a malformed session event crashes the orchestrator

Not a harness question, but it surfaced while checking what a stub may emit. `spawnTracked`
broadcasts any event carrying a session id (`src/server/services/sessions.ts:308-317`); the hub
validates on broadcast against `sessionWireEventSchema`, whose `sessionId` is `z.uuid()`
(`src/sessions/events.ts:156-161`); the ZodError throws inside the readline `"line"` listener
(`src/sessions/runner.ts:206-221`) and nothing installs an `uncaughtException` handler. A CLI
event with a non-uuid `session_id` therefore takes the server down rather than failing the spawn.
Recorded in [loop-findings](../../.helm/research/loop-findings.md).
