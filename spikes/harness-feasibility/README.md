# Harness feasibility

Three unknowns story 005-05 (the zero-cost gate harness) rested on, measured instead of assumed.
Run on node v24.18.0, against `cbd6844`.

Rounds 1 and 3 below mirrored the product with stand-ins; the gate's next pass called that out, so
§1b and §2b re-ran the same two questions against the product's own code paths. Both original
conclusions held; both re-runs found something the stand-in had hidden.

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

## 1b. The same, through the product's registration and mount — works

`mcp-product-path.ts`. §1 registered a raw zod *shape* against a hand-rolled `node:http` bridge;
the product registers a whole zod **object schema** through an `as unknown as RegisterTool` cast
(`src/server/mcp/server.ts:14-18,80,92-111`) and mounts hono on the stack's node server
(`ctx.http.mount`, `src/server/services/mcp.ts:39`). Re-run with the real
`flagRiskPayloadSchema`, the real cast, and a real `createNodeServer`:

```
tools/list inputSchema: {"type":"object","properties":{"title":{"type":"string","minLength":1},
  "detail":{"type":"string","minLength":1}},"required":["title","detail"],…}
valid call: [{"type":"text","text":"Flag recorded."}] isError: undefined
invalid payload -> resolved isError=true [{"type":"text","text":"MCP error -32602: Input validation
  error: Invalid arguments for tool flag_risk: …
not-ready refusal: [{"type":"text","text":"session is not initialized yet"}] isError: true
unknown tool -> resolved isError=true
handler received: [ 'F1' ]
```

The object schema derives the same JSON schema a raw shape does, and the SDK still validates
against it. Two additions to the stub's contract:

- **A payload refusal never reaches the handler.** The SDK rejects it first, so its text is
  `MCP error -32602: Input validation error…`, not the handler's `prettifyError` output. A stub
  splitting fatal from retryable matches on the SDK's text for malformed payloads and on the
  handler's text for the two not-ready refusals.
- **Success carries `isError: undefined`, not `false`**, and an unknown tool name resolves like any
  other refusal. So the test is `result.isError === true`; nothing throws in any branch.

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

## 2b. The real orchestrator, booted from that scratch cwd — works, with two corrections

`scratch-orchestrator.ts` + `scratch-entry.ts`. §2 proved the mechanism against a stand-in app;
this boots the product — every service in `src/server/services/index.ts`, the real worker, the real
board watcher — against a scratch repo, and drives one RPC:

```
board: watching /tmp/helm-harness-spike2/repo
service board / gate / mcp / meter / proposals / review / runs / sessions: started
stack node: listening on http://localhost:8799
GET / -> 200 <!doctype html> <html lang="en">…
POST /rpc/board/get -> 200 {"json":{"epics":[{"id":"001",…}],"stories":[{"id":"001-01",…
```

Two things the stand-in hid:

- **The entry cannot live in the scratch directory.** Node resolves bare specifiers by walking up
  from the importing *file*, so a `scratch-server.ts` written next to the scratch config fails with
  `ERR_MODULE_NOT_FOUND: Cannot find package '@fcalell/plugin-node'`, and `NODE_PATH` does not
  apply to ESM. The entry stays in the repo and the *process* runs from the scratch cwd — which is
  all `helm.config.json` and `staticRoot` read anyway. It also cannot be `.stack/server.ts`, whose
  port 8788 is hardcoded and already owned by the developer's `stack dev`; a four-line entry
  calling `startNodeServer` with its own port and absolute module URLs is otherwise identical.
- **`epicFrontmatterSchema` is strict and holds only `sessions`** (`src/board/schema.ts:85-87`) —
  the ordinal comes from the directory name. An `id:` key in `epic.md` drops the epic from the
  board silently, stories and all shown but the epic list empty.

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
