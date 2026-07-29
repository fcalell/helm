---
id: 005-05
status: ready
depends: []
gate: { passed: 2026-07-30T00:00:00.000Z, brief: 1cff04a9980b03b2, overrides: [] }
sessions: {}
---
# Harness drives flagged gate rounds

## Goal

A committed harness drives a full gate episode — flagged rounds, a contested flag, an accepted
fix, an exhausted attempt — against a scratch orchestrator at zero pool cost. Today none of that
is reachable without spending real Opus tokens on the adversary, the pool this epic exists to
protect, because the only stand-in for the CLI was an uncommitted trick from the 002-07 loop ("a
stub `claude` that logs its argv and replays real stream-json frames",
`.helm/research/usage.md:310`) and a replay-only stub never calls the orchestrator's board tools,
so its round is always flagless and always passes (`src/server/services/gate.ts:238-241`). The
loop's most expensive machinery is its least verifiable, which is why story 005-01's live
criteria collapsed into "graded by reading". The harness is two halves, because a gate episode is
two things: a per-process **stub** standing in for `claude`, and an **episode driver** performing
the beats a user performs over the orchestrator's own API. Neither half alone drives anything
past a flagless pass.

## Approach

**Spiked at `cbd6844`** (`spikes/harness-feasibility/`, node v24.18.0) — the three assumptions
this design rested on, now measured against the product's own code paths, several of them the
opposite of what the brief assumed:

- **An MCP SDK client drives the product's `@hono/mcp` route, registered the way the product
  registers.** `mcp-client.ts` mirrors `src/server/services/mcp.ts:18-26` (token lookup, fresh
  `McpServer` + `StreamableHTTPTransport` per request, no session id): `initialize`, `tools/list`
  and two `tools/call`s all land, the second against a *different* server instance, so the
  stateless route needs no session affinity. `mcp-product-path.ts` re-runs it through the real
  `flagRiskPayloadSchema` registered as a whole **object schema** across the
  `as unknown as RegisterTool` cast (`src/server/mcp/server.ts:14-18,80,92-111`) and mounted on a
  real `createNodeServer` via `ctx.http.mount`: same JSON schema, same behavior. Three facts the
  stub's client is built on, all measured — **nothing throws in any branch**, so the test is
  `result.isError === true` (a success carries `isError: undefined`, not `false`); a **malformed
  payload never reaches the handler**, the SDK rejects it first as
  `MCP error -32602: Input validation error…`, not the handler's `prettifyError` text; and an
  unknown tool name resolves as a refusal like any other.
- **The real orchestrator boots from a scratch cwd with a symlinked `dist/client`.**
  `loadManagedRepo` reads `helm.config.json` from the process cwd (`src/server/config.ts:20,26`)
  and `staticRoot` is cwd-relative too
  (`../stack/plugins/node/src/server/create-node-server.ts:53,115`), so a scratch cwd isolates the
  config and a `dist/client` symlink restores the UI. `scratch-orchestrator.ts` starts the product
  itself — all eight services, the real worker, the board watcher on the scratch repo, `GET / ->
  200`, `POST /rpc/board/get -> 200` with the fixture story. Two constraints on how it starts, both
  found by starting it: `dist/client` and the entry's `.stack/worker.ts` and `.stack/procedure.ts`
  are all **build outputs, not committed**, so the driver checks each exists and stops with the
  `stack generate && stack build` instruction rather than serving a dangling symlink or a stale UI
  (`package.json:9-11`); and the entry **must live in this repo**, since node resolves bare
  specifiers by walking up from the importing file (an entry beside the scratch config dies with
  `ERR_MODULE_NOT_FOUND` on `@fcalell/plugin-node`, and `NODE_PATH` does not apply to ESM); and it
  **cannot be `.stack/server.ts`**, whose port 8788 is hardcoded and owned by the developer's
  `stack dev` — a four-line entry calling `startNodeServer` with its own port and absolute module
  URLs is otherwise identical. The developer's gitignored `helm.config.json` is never touched,
  unlike `spikes/permission-live`.
- **An extensionless ESM `claude` shim importing a `.ts` sibling works.** `shim/claude` spawned
  the way the orchestrator spawns it (`spawn("claude", args)`, `runner.ts:183`, shim dir on
  `PATH`) exits 0 having loaded the typed sibling — node strips types through the import, so the
  executable stays three lines of JS and `tsc` covers the implementation.
- **A stub that dies *after* init is invisible to the gate**, so the harness must watch exit
  codes: `SessionSpawnError` (`runner.ts:74-91`) fires only for a death before init, after which
  `runRound` awaits `run.done` and, seeing no flags, calls `writePass` and moves the story to
  Ready (`gate.ts:237-241`, `:319-341`) whatever the exit code.
- **A non-uuid `session_id` crashes the orchestrator** rather than failing the spawn: any event
  carrying a session id is broadcast (`sessions.ts:308-317`), the hub validates on broadcast
  against `z.uuid()` (`events.ts:156-161`), and the ZodError throws in the readline listener with
  no `uncaughtException` handler. That is a product defect, recorded in
  [loop-findings](../../../research/loop-findings.md) §005 refinement; this story keeps its
  frames valid rather than grading a crash.

Measured at `cbd6844`:

- **A gate episode is not one process, and half of it is the user.** A flag becomes `fixed` only
  through `gateBriefEdited` (`gate.ts:415-432`), reached only from `notifyGate`
  (`src/server/services/proposals.ts:566-574`), which `resolveProposalItem` calls at `:250` when
  the user accepts an `update_brief` — or a `resolve_question` — item. The refine session's
  `update_brief` with `resolves` (`src/server/mcp/tools.ts:157-197`, `gateFixProposed` at
  `gate.ts:437-461`) only records a pending proposal. And `exhausted` (`evaluate`, `:286-317`)
  needs no `open` and no `contested` flag, a complete brief, a **changed brief hash**, and
  `rounds.length >= 2` — the hash moves only when an accepted proposal edits the body, and a
  proposal whose text is byte-identical leaves it put, sending the attempt to `writePass` instead.
  So the exhausted episode is: flag → fix proposal → *user accepts a real edit* → round 2 → flag →
  fix proposal → *user accepts a real edit*, and the driver must assert the body actually moved
  after each accept or a silent pass looks like success.
- **One driver beat can trigger two spawns, so scripts cannot be handed over just in time.**
  `runRound` awaits the adversary (`gate.ts:214-220`) and then calls `routeFlags` (`:242`), which
  spawns the refine resume through `messageSession` (`:258-261`) inside the same dispatched task;
  round 2 chains off one accept the same way (`proposals.ts:250` → `evaluate` → `enqueueRound`,
  `gate.ts:312-314`). There is no RPC in between and no observable the driver can wait on. The
  handoff is therefore **pre-written, not just-in-time**: the driver writes every script of the
  episode before it starts, into a directory keyed by role and ordinal
  (`adversary-1.json`, `refine-1.json`, `adversary-2.json`, …), and the stub takes the next
  unclaimed ordinal for its role (selection key in the next bullet) through an exclusive create —
  `open("<script>.claim", "wx")`, which fails `EEXIST` if another spawn holds it, the one atomic
  claim node exposes portably (`rename` overwrites silently and `RENAME_NOREPLACE` is Linux-only).
  Overlapping spawns therefore can never read the same script or race a writer.
- **The kind is on the command line, and nothing on it identifies the individual spawn.** The MCP
  token is a bare `randomUUID()` (`sessions.ts:286`) and the kind lives server-side in the binding
  map (`src/server/mcp/registry.ts:7-17`), so the URL carries none — but `--allowedTools` carries
  the kind's board tools verbatim (`runner.ts:132-136`), `mcp__helm__flag_risk` for adversary
  against `mcp__helm__update_brief` for refine (`kinds.ts:207-211`, `:224`), and `--model` and
  `--effort` differ too (`:203-204`, `:220-221`). So a script is claimed by the tool list, a
  machine-readable key, not by matching prose in the role line.
  **Nothing distinguishes one spawn of a role from the next**, though: every adversary spawn has
  `--resume` absent (`runner.ts:181`) and no seed (`seedFor` returns `undefined` off the refine
  kind, `sessions.ts:447`), and every refine *resume* has `--resume` present and no seed
  (`:369-370`). An unplanned same-role spawn therefore cannot be caught at the spawn that drifted;
  it is caught at the two ends instead — a spawn past the declared count finds no script and exits
  non-zero *before* init (`SessionSpawnError`, loud and immediate), and the driver compares the
  log's whole role sequence against the declaration at the end. That is the honest limit of a
  pre-written directory, and it is why the sequence is declared per episode rather than inferred.
- **The refine session must exist before any flagged round.** `routeFlags` gives up and jumps to
  `review` unless `story.frontmatter.sessions.refine` is set (`gate.ts:245-254`), written only by
  a `refine` spawn through `session.spawn` (`sessions.ts:583-601`). Two branches follow:
  `messageSession` throws `SESSION_BUSY` while that session is live (`sessions.ts:186-191`),
  which `routeFlags` swallows into `pendingFlags` and a stall retried only from `onClosed`
  (`gate.ts:264-268`, `:530-533`); and a stale resume reseeds under a fresh id
  (`sessions.ts:204-227`), so the stub echoes back the `--resume` id it was handed. `session.spawn`
  returns at `system/init` (`sessions.ts:375`) with the process still live, so the driver waits
  for that session's `closed` frame on the `session` channel before starting the gate.
  **The same wait is needed before every proposal accept**, and for the same reason: the pending
  proposal is broadcast the moment the stub's `update_brief` lands
  (`src/server/mcp/tools.ts:170-177`
  → `recordProposal`), while the refine resume is still in `live`. Accepting it there runs
  `notifyGate` → `gateBriefEdited` → `evaluate` → `enqueueRound` (`gate.ts:431`, `:312-314`)
  against a session that has not closed, so round 2's `routeFlags` hits `SESSION_BUSY`
  (`sessions.ts:186-191`) and parks on `pendingFlags`, and a second `evaluate` from `onClosed`
  (`:540`) can race the first past the unguarded `rounds.length < 2` check into an unplanned third
  round. So the driver's rule is one line: **resolve a proposal only after the session that
  proposed it has closed.** That is the observable the "one driver beat, two spawns" bullet says
  does not exist *between* the gate's own chained spawns — it does exist around the driver's beats.
- **The driver's eyes are the WS channels, not procedures.** `src/worker/routes/gate.ts` exposes
  only `resolveFlag`, so gate phase and flags are readable only from the `gate` channel; a
  pending proposal's id arrives on the `proposal` channel; session liveness on the `session`
  channel; dispatcher queue occupancy and the meter on the `meter` channel, which has no worker
  route either (`src/server/services/meter.ts:42,82`). The driver subscribes to all five channels
  `src/shared/channels.ts` defines.
- **A spawn failure is not observable as `SessionSpawnError`.** `runColdSession` wraps it through
  `asSpawnFailed` into `ApiError("SPAWN_FAILED")` (`sessions.ts:454-457`), and on the gate path
  that becomes a `gate-aborted` notice on the **board** channel with the attempt dropped
  (`gate.ts:194-200` → `abortWith` `:94-99`). So a probe expecting a dead spawn asserts that
  notice plus the vacated dispatcher slot on the `meter` channel, never a named error class.
- **The scratch board is a fixture, written directly; the episode's beats are not.** There is no
  `story.create` procedure (`src/worker/routes/`: `board.get`, `epic.create`, `story.move`,
  `story.setPreset`, `session.*`, `proposal.*`, `gate.resolveFlag`) — stories are minted only by
  accepting `propose_stories` (`proposals.ts:470-524`), which needs a define/shape session this
  story does not script. And every episode needs a brief that already passes `checkReadyGate`
  (`src/board/transitions.ts:22-47`). So setup writes the board files by hand, exactly as
  `spikes/permission-live/setup-scratch.ts` and `gen-story.ts` do; the rule the harness holds is
  narrower and worth stating exactly: **after setup, every state change goes through the API.**
- **Pointing the orchestrator at the scratch repo** is the spiked recipe above: a scratch
  directory holding its own `helm.config.json` and a `dist/client` symlink, plus a small entry in
  `harness/episode/` (not the scratch dir, not `.stack/server.ts`) run with that directory as cwd
  on its own port. The developer's gitignored `helm.config.json` is never read or written. The
  fixture's `epic.md` carries `sessions` and nothing else — `epicFrontmatterSchema` is strict
  (`src/board/schema.ts:85-87`) and an `id:` key drops the epic from the board silently.
- **The stub finds its script directory and log through the environment**, the only channel it
  inherits: `sessionEnv()` (`runner.ts:106-113`, applied at `:185`) passes the parent environment
  through, while the spawn's cwd is the managed repo (`sessions.ts:296`), not the driver's, so
  nothing is discoverable by convention. Three variables the driver controls, all inherited the
  same way: the script directory and the log file, both absolute paths, and **`PATH` with the stub
  directory prepended** — the mechanism that makes `spawn("claude", …)` find the stub at all. The
  log's path is a variable because the stub cannot guess it, but the driver always puts it at a
  fixed spot: the scratch root is `/tmp/helm-harness/<episode>/` (its repo at `repo/`, its
  `helm.config.json` and `dist/client` symlink beside it, modelled on `spikes/permission-live`'s
  `/tmp/helm-scratch`), and the log is `/tmp/helm-harness/<episode>/spawns.log`. The driver leaves
  it there after the run — it is what the `(file)` criteria below are read from, so an episode's
  evidence outlives the episode.
- **RPC and WS wire shapes** follow the only in-repo precedent, `spikes/permission-live`: RPC is
  `POST /rpc/<route>/<procedure>` with a `{json: …}` envelope (`approve-loop.ts:29-33`), and the
  socket is `ws://<host>/ws` with `{t:"sub",ch}` subscribe frames (`monitor.ts:4-10`).
- **What the spawn hands the stub, exactly** (`runner.ts:120-186`): `-p <prompt>`,
  `--output-format stream-json`, `--verbose`, `--include-partial-messages`, `--model`,
  `--effort`, `--permission-mode default`, `--allowedTools <csv>`, `--tools` **followed by N
  bare values** (a spread at `:155-156`, which a naive `--flag value` parser mis-consumes),
  `--system-prompt <text>`, `--strict-mcp-config`, `--mcp-config <json>`, optionally
  `--settings` (run kind only, `sessions.ts:400-433`), `--permission-prompt-tool`, and
  `--resume`. `spawn("claude", args)` runs with no shell (`:183`), so the harness puts an
  executable file named exactly `claude` on `PATH`. Node strips types by extension, so that file
  is a few lines of extensionless JS importing the `.ts` implementation beside it — which is what
  `tsc` then covers.
- **The `adversarySessionId` race has exactly one observable.** `recordAdversaryFlag` refuses
  unless the phase is `adversary` and `binding.sessionId` equals `attempt.adversarySessionId`
  (`:355-365`), assigned only after `runColdSession` resolves (`:214-219`), several microtasks
  after the init line is read. The stub cannot observe that assignment, but the refusals are
  distinguishable: "session is not initialized yet" (`src/server/mcp/server.ts:100-107`) and "no
  adversary round is running for this story" (`gate.ts:366`) are the race, while
  `flagRiskPayloadSchema` validation errors (`src/server/mcp/schemas.ts:124-127`) and "a flag
  titled … already exists this round" (`gate.ts:370-372`) are scenario bugs. That split is what
  makes bounded retry safe and a genuine rejection loud.
- **What renders where, and how long it exists.** `GatePanel`
  (`src/app/components/gate-panel.tsx:172-216`) shows the phase line, `FlagWidget` for flags
  filtered to `contested` (`:174-176`, `:200-202`), and `RoundHistory` only at `exhausted`
  (`:203-208`) — badge plus title, never `detail`. An `open` or `fixed` flag renders nowhere, so a
  flag's arrival is asserted from the `gate` channel and only the contested and exhausted surfaces
  are asserted in the UI. Both are **live-attempt state and vanish when the attempt does**:
  `attempts` is an in-memory map (`gate.ts:53`), a dismissal runs `evaluate` → `writePass` →
  `abort` (`:503-507`, `:309`, `:350`) and `GatePanel` renders nothing without an attempt
  (`gate-panel.tsx:179`). So those two episodes **stop with the panel live and wait for the
  operator**, holding the server, printing the scratch URL, and performing the resolving beat only
  after the operator continues. Every other episode runs unattended. No `src/` change is needed to
  satisfy any criterion here.
- **`pnpm check` does not see a new top-level directory.** `package.json:12` is
  `tsc --noEmit && biome check --write --unsafe` and `tsconfig.json:9` includes only `src`,
  `.stack`, `stack.config.ts`, so `harness/` compiles only if `tsconfig.json` is edited. Biome
  already covers it (`biome.json` includes `**/*`, excluding `spikes`).
- **The meter cannot prove zero spend**: it sums `usage` from `result` events
  (`src/sessions/events.ts:44-88`), which the stub authors. The argv log is the evidence —
  exactly the expected spawns, all of them the stub, all exiting zero.
- CLAUDE.md's "Where things are" lists `spikes/` as throwaway, one folder per spike, and states
  the repo has no tests, so durable verification tooling has no home. User decision, this
  attempt: `harness/`.

Changes:

1. **`harness/stub-claude/`** — an executable file named `claude` (shebang, `+x`, extensionless
   JS, three lines importing the implementation) plus the `.ts` modules it loads. It parses argv
   exactly as `runner.ts:120-186` writes it, including the bare-value spread after `--tools`,
   appends its argv and exit code to a log file, claims its script, emits stream-json frames on
   stdout, makes board-tool calls, and exits. Its init frame carries a uuid `session_id`, echoing
   `--resume`'s id when given.
2. **A pre-written script directory, each script bound to the role it expects.** The driver
   writes every script of an episode before it starts, named `<role>-<ordinal>.json`; the stub
   reads the role off `--allowedTools` and claims the lowest unclaimed ordinal for that role
   through the exclusive create above, so overlapping spawns never take the same script. A claimed
   script whose declared role does not match the spawn's tool list fails loudly. Ordinal drift —
   an unplanned same-role spawn shifting the tail, from a discarded round re-enqueuing an adversary
   (`gate.ts:230-236`), a `SESSION_BUSY` stall retried from `onClosed` (`:264-268`, `:530-533`), or
   a proposal edit/reject dispatching a resume (`proposals.ts:260-270`) — has no per-spawn tell
   (facts block), so it is caught at the ends: the extra spawn eventually finds no script and dies
   before init, and the driver compares the log's whole sequence against the episode's declaration.
   Steps are `emit` (a frame), `call` (a
   board tool with its payload) or `exit`. Two distinct absences, because they need opposite
   behavior: **no script directory configured** is the flagless default (bare init, flagless
   result — today's stub behavior, kept), while **a configured directory with no script for this
   role/ordinal, or an unreadable one**, exits non-zero *before* init, which reaches the harness as
   a `gate-aborted` notice (facts block) instead of a silent flagless pass.
3. **A board-tool client in the stub**: it reads the `helm` URL out of `--mcp-config` and issues
   `call` steps against it, reading `result.isError` and the error text rather than catching
   (spiked: a rejection resolves). Refusals split two ways, and every refusal is logged with its
   text: the two not-ready refusals retry on a bounded backoff, and any other error text fails
   the stub with a non-zero exit — which only matters because change 4 has someone watching.
4. **`harness/episode/`, the driver** — it writes the scratch repo and its board fixture directly
   (modelled on `spikes/permission-live/setup-scratch.ts`, but **without a valid `gate` block**:
   `gen-story.ts` writes stories with a valid gate hash, which `requestReady` short-circuits at
   `gate.ts:152-159` so no attempt ever starts), writes the scratch `helm.config.json` and
   `dist/client` symlink, starts the orchestrator from that cwd, pre-writes the episode's
   scripts, subscribes to all five WS channels, and then plays
   every state change through the API alone: `session.spawn` for the refine chat (waiting for its
   `closed` frame before gating, so `messageSession` never hits `SESSION_BUSY`), `story.move`
   into Ready, proposal resolution for the fix, `gate.resolveFlag` for a contested one. It
   asserts on the WS snapshots, and asserts the brief body actually changed after each accepted fix
   (a byte-identical edit leaves the hash put and routes to `writePass` instead of `exhausted`,
   `gate.ts:308-316`).

   **Each episode declares its expected spawn sequence and each spawn's expected exit code**,
   because neither is obvious. The sequence counts the driver's own beats, not just the gate's:
   the refine chat the driver spawns before gating is itself a stub spawn and claims `refine-1`,
   so a flagged round's fix resume is `refine-2`. And accepting a fix changes the hash, so
   `evaluate` re-enqueues while `rounds.length < 2` (`gate.ts:308-315`). The one-flag episode is
   therefore `refine-1` (the chat), `adversary-1` (flags), `refine-2` (the fix proposal),
   `adversary-2` (flagless, landing Ready). The expected exit code is zero for every spawn of
   every episode; **a failure probe declares the one spawn it expects to fail and its code**, which
   is what keeps "a non-zero exit fails the episode" and "this probe's stub must exit non-zero"
   from contradicting each other — the rule is that the log must match the declaration, and a
   missing completion entry fails either way. Four gate episodes ship — flagless pass, one flagged
   round fixed, one flagged round left contested and **dismissed** (dismissal leaves the hash put,
   so the attempt passes to Ready, `gate.ts:503-509`), and the two-round exhausted attempt — plus
   **four** failure probes: a stub exiting non-zero after init (which the gate cannot see, so the
   probe asserts both the log mismatch *and* the spurious Ready the story lands in,
   `gate.ts:237-241`, `:319-341` — that spurious pass is the whole reason the exit-code rule
   exists), a configured-but-missing script, a script calling `flag_risk` with an invalid payload,
   and a refine script that ends its turn without answering (the `concedeOpenFlags` path,
   `gate.ts:278-284`).
5. **Docs**: claude-integration.md §Verifying without burning the pool stops describing a trick
   and points at the harness — the two halves, where they live, how scripts reach spawns, and
   that board-tool calls make flagged rounds and exhausted attempts zero-cost. CLAUDE.md's "Where
   things are" gains `harness/`, and `tsconfig.json` includes it so `pnpm check` compiles it.

## Blast radius

- `harness/stub-claude/` (new) — the `claude` shim, argv parsing, the frame emitter, the MCP
  client with its retry/fail split, the atomic script claim, and the argv/exit log.
- `harness/episode/` (new) — scratch repo and verdict-free board fixture, the scratch
  `helm.config.json` and `dist/client` symlink, the scratch orchestrator entry and its lifecycle,
  the WS subscriptions, the RPC beats, script pre-writing, and the four gate episodes plus four
  failure probes with their declared spawn sequences, expected exit codes and assertions — two of
  the episodes halting on an operator prompt with the server up.
- `tsconfig.json` — `include` gains `harness`, so `pnpm check` type-checks the harness's `.ts`
  modules. Nothing else in the root config moves; biome already covers the tree.
- `CLAUDE.md` — one line in "Where things are" for `harness/`.
- `.helm/knowledge/architecture/claude-integration.md` §Verifying without burning the pool — the
  stub bullet becomes the harness's two halves and the new capability.
- No `src/` file changes: every beat is an existing procedure and every assertion an existing
  channel or an on-disk file. If that turns out to be false the story stops and says so rather
  than widening the product to suit its harness.
- Machine state: the developer's `helm.config.json` is never read or written — the orchestrator
  runs from a scratch cwd with its own. Behavioral reach in the product: none. The risk carried
  is drift — a stub that diverges from what the CLI really emits verifies nothing — which is why
  its frames are copied from recorded real output rather than invented, and why the argv log
  exists.

## Acceptance criteria

- [ ] `harness/stub-claude/` ships an executable file named exactly `claude` with a shebang and
      the executable bit, extensionless ESM importing the `.ts` implementation beside it, and that
      implementation uses erasable syntax only (node strips types at runtime; the repo's tsconfig
      does not set `erasableSyntaxOnly`, so `pnpm check` would not catch a violation). (file)
- [ ] Spawned through `PATH` the way the orchestrator spawns it (`spawn("claude", args)`,
      `src/sessions/runner.ts:183`) with a script directory configured, the stub emits the
      scripted frames on stdout and exits 0. (live)
- [ ] The stub's argv parser handles every flag `runner.ts:120-186` writes, including the
      bare-value spread after `--tools` and the `--settings` and `--permission-prompt-tool` pair no
      gate spawn carries (`runTurn` passes neither, `sessions.ts:360-389` against `:400-433`) —
      those two are read off the parser source, everything a gate spawn does carry is read off
      `/tmp/helm-harness/<episode>/spawns.log`, which records the parse of every spawn of a full
      episode
      with each flag's value where the runner put it. (file)
- [ ] The stub's init frame satisfies `parseInitEvent` (`src/sessions/events.ts:30-38`) with a
      uuid `session_id`, echoing `--resume`'s id when one is given; its result frame satisfies
      `parseResultEvent` (`:68-88`). No frame ever carries a non-uuid session id, which would
      crash the orchestrator rather than fail the spawn (Approach). (live)
- [ ] The stub reaches its script directory and log file through two absolute-path environment
      variables, and is reached at all through a third, `PATH` — the only channel a spawn inherits
      (`runner.ts:106-113`, `:185`), since its cwd is the managed repo (`sessions.ts:296`);
      `/tmp/helm-harness/<episode>/spawns.log` records the three values it ran with. (file)
- [ ] A script is claimed by the role on `--allowedTools` (`runner.ts:132-136`,
      `kinds.ts:207-211`, `:224`), not by prose in the role line:
      `/tmp/helm-harness/<episode>/spawns.log` records the role
      each spawn resolved and the script it claimed, and the stub's claim path fails the spawn
      loudly when a claimed script's declared role does not match — a guard no shipped episode
      drives, so it is graded by reading the stub, not by running one. (file)
- [ ] With no script directory configured the stub emits a bare init and a flagless result; with
      one configured but no script for its role and ordinal, or an unreadable script, it exits
      non-zero **before** init, which `runner.ts:74-91` turns into `SessionSpawnError` and
      `runColdSession` rethrows as `ApiError("SPAWN_FAILED")` (`sessions.ts:157-159`, `:454-457`),
      reaching the harness as a `gate-aborted` notice on the board channel with the dispatcher slot
      vacated on the meter channel (`gate.ts:194-200`, `:94-99`). (live)
- [ ] The stub's tool client tests `result.isError === true` rather than catching (no branch
      throws, and a success carries `isError: undefined` — Approach), logs every refusal, retries
      only the two not-ready refusals — "session is not initialized yet"
      (`src/server/mcp/server.ts:100-107`) and "no adversary round is running for this story"
      (`src/server/services/gate.ts:366`) — on a bounded backoff, and exits non-zero on any other
      error text, including the SDK's own `MCP error -32602` payload rejection. (file)
- [ ] The invalid-payload probe records the fatal refusal (`MCP error -32602`) in
      `/tmp/helm-harness/<episode>/spawns.log` and
      the stub exits non-zero without retrying it, which the probe declares and the driver matches.
      (live)
- [ ] The non-zero-after-init probe declares its stub's non-zero exit, and asserts that the story
      nevertheless lands in **Ready** with a recorded verdict (`gate.ts:237-241`, `:319-341`) —
      the spurious pass the exit-code rule exists to catch, which is only caught here because the
      log's declared code is what the driver compares against. (live)
- [ ] The missing-script probe ships as its own episode with a declared sequence: one adversary
      spawn that finds no script for its ordinal, its non-zero pre-init exit declared, and the
      `gate-aborted` notice asserted with the story still in Refining. (live)
- [ ] `harness/episode/` writes the scratch repo, its board fixture, a scratch `helm.config.json`
      and a `dist/client` symlink, checks its three build-output preconditions (`dist/client`,
      `.stack/worker.ts`, `.stack/procedure.ts` — none committed) and stops with the
      `stack generate && stack build` instruction when any is missing, then starts the
      orchestrator from that cwd on its own port — every service up, the board watching the scratch
      repo, the SPA and `/rpc` both answering — without reading or writing the developer's
      `helm.config.json`. (live)
- [ ] The board fixture's story carries a brief that passes `checkReadyGate`
      (`src/board/transitions.ts:22-47`) and **no valid `gate` verdict**, so `requestReady` starts
      an attempt instead of short-circuiting to Ready (`gate.ts:152-159`). (file)
- [ ] After setup, every state change the driver makes goes through the orchestrator's API —
      `session.spawn`, `story.move`, proposal resolution, `gate.resolveFlag`, over
      `POST /rpc/<route>/<procedure>` — with no direct write to the scratch board's files, and
      every assertion reads a WS channel snapshot or an on-disk file. Read off `harness/episode/`:
      no filesystem write to the scratch board outside setup. (file)
- [ ] The driver waits for a `closed` frame on the `session` channel twice: after spawning the
      refine chat, before starting the gate, so `routeFlags` (`gate.ts:245-254`) routes instead of
      conceding; and after each fix proposal arrives, before resolving it, so the round it
      enqueues never finds the refine session still live. Both waits are read off
      `harness/episode/`: a `SESSION_BUSY` stall is invisible to every instrument the driver has —
      `routeFlags` swallows it into `pendingFlags` (`gate.ts:265-267`), a field `snapshot()` does
      not carry (`:57-66`), and the retry re-spawns the same role and ordinal — so the ordering
      rule is the evidence, not a runtime assertion. (file)
- [ ] The observable half holds across every episode: each fix proposal's `closed` frame precedes
      its resolution on the `session` channel, and the gate snapshot's `rounds.length` never
      exceeds the episode's declared round count. (live)
- [ ] Every episode declares its expected spawn sequence and the driver fails it when the log's
      sequence differs — counting the driver's own refine chat as `refine-1`, so a flagged round's
      fix resume is `refine-2`, and including the second adversary round an accepted fix always
      buys while `rounds.length < 2` (`gate.ts:308-315`). Read off
      `/tmp/helm-harness/<episode>/spawns.log`,
      which shows exactly the declared spawns and no others, every one of them the stub. (file)
- [ ] Every stub spawn writes a start entry and a completion entry carrying its exit code, every
      episode declares the code it expects per spawn (zero everywhere but a failure probe's one
      declared spawn), and the driver fails the episode on any mismatch **or a missing completion**
      (a killed or crashed stub logs none), rather than letting the flagless `writePass` path
      (`gate.ts:237-241`) read as a clean gate pass. Read off
      `/tmp/helm-harness/<episode>/spawns.log`. (file)
- [ ] `tsconfig.json`'s `include` covers `harness`, and `pnpm check` passes. (command)
- [ ] The flagless episode drives a refining story into Ready with a recorded `gate` verdict —
      today's behavior, unbroken. (live)
- [ ] The one-flag episode drives a round whose flag appears on the `gate` channel with its title
      and detail, routes to the refine session, settles `fixed` when the driver accepts the fix
      proposal with a body change the driver asserts, and lands in Ready after the flagless second
      round. (live)
- [ ] The contested episode **halts with the server up** on a contested flag, so the operator sees
      its `FlagWidget` and counter-argument in the drawer with the story still in Refining; on
      continue the driver dismisses it through `gate.resolveFlag`, the override is recorded, and
      the story moves to Ready with the brief unchanged (`gate.ts:503-509`). (live)
- [ ] The two-round episode reaches the `exhausted` phase — two flagged rounds, each fix accepted
      with an asserted body change — and **halts there with the server up**, so the operator sees
      the panel's round history and the card's gate badge before the attempt is dropped. (live)
- [ ] The concession probe's refine script ends its turn without answering, leaving that round's
      open flags auto-contested with no counter-argument (`concedeOpenFlags`, `gate.ts:278-284`,
      via `onClosed` `:526-542`) — the path this harness exists to make reachable. (live)
- [ ] Every episode prints the meter's reading from the `meter` channel alongside its result, and
      says in the same breath that the reading is not the evidence — the stub authors its own
      `usage` (`src/sessions/events.ts:44-88`), so the log is what proves zero spend. (live)
- [ ] `.helm/knowledge/architecture/claude-integration.md` §Verifying without burning the pool
      describes the harness's two halves, where they live, the three environment variables, the
      scratch-cwd recipe and why the entry cannot live in the scratch directory, and that
      board-tool calls make flagged rounds and exhausted attempts
      zero-cost — instead of a one-off trick; `CLAUDE.md`'s "Where things are" lists `harness/`.
      (file)

## Out of scope

- Any change under `src/`: if the harness cannot be driven with what the spawn already passes and
  the API already exposes, the story stops and reports rather than widening the product.
- Scripts for the `run`, `review`, `define`, `shape` or `init` kinds: this story ships what the
  gate needs (adversary and refine); other kinds ride the stories that need them.
- Creating board fixtures through the API: no `story.create` procedure exists, so setup writes
  files directly and only the episode's beats are API-driven.
- A recording mode that captures real CLI output into script files: frames are copied by hand
  from recorded output for now.
- Browser-driven UI assertions (the playwright-core pattern): the two panel checks are by hand
  against the running scratch app, which is why those two episodes halt for an operator instead of
  running unattended.
- Replacing real-CLI verification: behavior only the live CLI shows (compaction, refusals,
  rate-limit events) still needs a real spawn.
- Running the harness in CI or wiring it into `pnpm check`: it is a tool a person runs.

## Open questions
