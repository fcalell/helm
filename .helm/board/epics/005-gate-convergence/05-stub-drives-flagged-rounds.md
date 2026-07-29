---
id: 005-05
status: refining
depends: []
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
this design rested on, now measured, two of them the opposite of what the brief assumed:

- **An MCP SDK client drives the product's `@hono/mcp` route.** `mcp-client.ts` mirrors
  `src/server/services/mcp.ts:18-26` (token lookup, fresh `McpServer` + `StreamableHTTPTransport`
  per request, no session id) and drives it with `Client` + `StreamableHTTPClientTransport`:
  `initialize`, `tools/list` and two `tools/call`s all land, the second against a *different*
  server instance, so the stateless route needs no session affinity. **A rejected call resolves
  with `isError: true` and the error text in its content — it does not throw**, so the stub's
  retryable-vs-fatal split reads `result.isError`, never a `catch`.
- **A scratch cwd with a symlinked `dist/client` keeps the SPA.** `scratch-cwd.ts`:
  `loadManagedRepo` reads `helm.config.json` from the process cwd (`src/server/config.ts:20,26`)
  while `.stack/server.ts` hardcodes `staticRoot: "dist/client"`, also cwd-relative
  (`../stack/plugins/node/src/server/create-node-server.ts:53,115`) — so a scratch cwd isolates
  the config but loses the UI, and a `dist/client` symlink restores it (`GET / -> 200`). The
  developer's gitignored `helm.config.json` is never touched, unlike `spikes/permission-live`.
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
  (`adversary-1.json`, `refine-1.json`, `adversary-2.json`, …), and the stub selects its own by
  matching the role line in `--system-prompt` and taking the next unused ordinal for that role
  through an atomic claim (an `O_EXCL` rename), so overlapping spawns can never read the same
  script or race a writer.
- **Kind discrimination is only possible from the system prompt.** The MCP token is a bare
  `randomUUID()` (`sessions.ts:286`) and the kind lives server-side in the binding map
  (`src/server/mcp/registry.ts:7-17`), so the URL carries none. The role line does
  (`kinds.ts:214` refine, `:226` adversary), so a script is *claimed* by role line — and
  *verified* against the two remaining discriminators, `--resume`'s presence and the first-spawn
  seed (`sessions.ts:369-371`), which is what catches an unplanned same-role spawn shifting the
  ordinals (change 2).
- **The refine session must exist before any flagged round.** `routeFlags` gives up and jumps to
  `review` unless `story.frontmatter.sessions.refine` is set (`gate.ts:245-254`), written only by
  a `refine` spawn through `session.spawn` (`sessions.ts:583-601`). Two branches follow:
  `messageSession` throws `SESSION_BUSY` while that session is live (`sessions.ts:186-191`),
  which `routeFlags` swallows into `pendingFlags` and a stall retried only from `onClosed`
  (`gate.ts:264-268`, `:530-533`); and a stale resume reseeds under a fresh id
  (`sessions.ts:204-227`), so the stub echoes back the `--resume` id it was handed. `session.spawn`
  returns at `system/init` (`sessions.ts:375`) with the process still live, so the driver waits
  for that session's `closed` frame on the `session` channel before starting the gate.
- **The driver's eyes are the WS channels, not procedures.** `src/worker/routes/gate.ts` exposes
  only `resolveFlag`, so gate phase and flags are readable only from the `gate` channel; a
  pending proposal's id arrives on the `proposal` channel; session liveness on the `session`
  channel. The driver subscribes to all three plus `board`.
- **The scratch board is a fixture, written directly; the episode's beats are not.** There is no
  `story.create` procedure (`src/worker/routes/`: `board.get`, `epic.create`, `story.move`,
  `story.setPreset`, `session.*`, `proposal.*`, `gate.resolveFlag`) — stories are minted only by
  accepting `propose_stories` (`proposals.ts:470-524`), which needs a define/shape session this
  story does not script. And every episode needs a brief that already passes `checkReadyGate`
  (`src/board/transitions.ts:22-47`). So setup writes the board files by hand, exactly as
  `spikes/permission-live/setup-scratch.ts` and `gen-story.ts` do; the rule the harness holds is
  narrower and worth stating exactly: **after setup, every state change goes through the API.**
- **Pointing the orchestrator at the scratch repo** is the spiked recipe above: a scratch
  directory holding its own `helm.config.json` and a `dist/client` symlink, with the orchestrator
  started from it (`node .stack/server.ts` by absolute path, port 8788). The developer's
  gitignored `helm.config.json` is never read or written.
- **The stub finds its script directory and log through the environment**, the only channel it
  inherits: `sessionEnv()` (`runner.ts:106-113`, applied at `:185`) passes the parent environment
  through, while the spawn's cwd is the managed repo (`sessions.ts:296`), not the driver's, so
  nothing is discoverable by convention. Two variables, both absolute paths, named in the doc.
- **RPC and WS wire shapes** follow the only in-repo precedent, `spikes/permission-live`: RPC is
  `POST /rpc/<route>/<procedure>` with a `{json: …}` envelope (`approve-loop.ts:31-36`), and the
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
- **What renders where.** `GatePanel` (`src/app/components/gate-panel.tsx:170-215`) shows the
  phase line, `FlagWidget` for flags filtered to `contested` (`:174-176`, `:200-202`), and
  `RoundHistory` only at `exhausted` (`:203-208`) — badge plus title, never `detail`. An `open`
  or `fixed` flag renders nowhere, so a flag's arrival is asserted from the `gate` channel and
  only the contested and exhausted surfaces are asserted in the UI. No `src/` change is needed to
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
2. **A pre-written script directory, each script bound to the spawn it expects.** The driver
   writes every script of an episode before it starts, named `<role>-<ordinal>.json`; the stub
   matches the role line in `--system-prompt` (`kinds.ts:214`, `:226`) and atomically claims the
   lowest unclaimed ordinal for that role, so overlapping spawns never take the same script and
   no write races a read. Claiming by ordinal alone is not enough, because an unplanned same-role
   spawn shifts the whole tail silently — a discarded round re-enqueuing an adversary
   (`gate.ts:230-236`), a `SESSION_BUSY` stall retried from `onClosed` (`:264-268`, `:530-533`),
   or a proposal edit/reject dispatching a resume (`proposals.ts:260-270`). Each script therefore
   also **asserts what it expects of its spawn** — `--resume` present or absent, and whether the
   system prompt carries the refine seed appended only to a first spawn
   (`sessions.ts:369-371`) — and a mismatch is a loud failure, so drift is caught at the spawn
   that drifted rather than at the end of the directory. Steps are `emit` (a frame), `call` (a
   board tool with its payload) or `exit`. Two distinct absences, because they need opposite
   behavior: **no script directory configured** is the flagless default (bare init, flagless
   result — today's stub behavior, kept), while **a configured directory with no script for this
   role/ordinal, or an unreadable one**, exits non-zero *before* init, so the orchestrator
   surfaces it as `SessionSpawnError` (`runner.ts:74-91`) instead of a silent flagless pass.
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
   scripts, subscribes to the `board`, `gate`, `proposal` and `session` channels, and then plays
   every state change through the API alone: `session.spawn` for the refine chat (waiting for its
   `closed` frame before gating, so `messageSession` never hits `SESSION_BUSY`), `story.move`
   into Ready, proposal resolution for the fix, `gate.resolveFlag` for a contested one. It
   asserts on the WS snapshots, asserts the brief body actually changed after each accepted fix
   (a byte-identical edit leaves the hash put and routes to `writePass` instead of `exhausted`,
   `gate.ts:308-316`), and fails the episode unless every stub spawn logged both a start and a
   zero-exit completion.

   **Each episode declares its expected spawn sequence**, because the sequence is not obvious:
   accepting a fix changes the hash, so `evaluate` re-enqueues while `rounds.length < 2`
   (`gate.ts:308-315`) — the one-flag episode therefore spawns adversary-1, refine-1, adversary-2
   (flagless, landing Ready), and the exhausted episode adds refine-2 and a second accepted fix.
   Four gate episodes ship — flagless pass, one flagged round fixed, one flagged round left
   contested and **dismissed** (dismissal leaves the hash put, so the attempt passes to Ready,
   `gate.ts:503-509`), and the two-round exhausted attempt — plus three failure probes: a stub
   exiting non-zero after init, a configured-but-missing script, and a refine script that ends
   its turn without answering (the `concedeOpenFlags` path, `gate.ts:278-284`).
5. **Docs**: claude-integration.md §Verifying without burning the pool stops describing a trick
   and points at the harness — the two halves, where they live, how scripts reach spawns, and
   that board-tool calls make flagged rounds and exhausted attempts zero-cost. CLAUDE.md's "Where
   things are" gains `harness/`, and `tsconfig.json` includes it so `pnpm check` compiles it.

## Blast radius

- `harness/stub-claude/` (new) — the `claude` shim, argv parsing, the frame emitter, the MCP
  client with its retry/fail split, the atomic script claim, and the argv/exit log.
- `harness/episode/` (new) — scratch repo and verdict-free board fixture, the scratch
  `helm.config.json` and `dist/client` symlink, the orchestrator lifecycle, the WS subscriptions,
  the RPC beats, script pre-writing, and the four gate episodes plus three failure probes with
  their declared spawn sequences and assertions.
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
- [ ] The stub's argv parser handles every flag `runner.ts:120-186` writes, including `--tools`
      followed by bare values and the optional `--settings`, `--permission-prompt-tool` and
      `--resume`, and its log records what it parsed for each spawn. (live)
- [ ] The stub's init frame satisfies `parseInitEvent` (`src/sessions/events.ts:30-38`) with a
      uuid `session_id`, echoing `--resume`'s id when one is given; its result frame satisfies
      `parseResultEvent` (`:68-88`). No frame ever carries a non-uuid session id, which would
      crash the orchestrator rather than fail the spawn (Approach). (file)
- [ ] The script directory and the log file are located from two absolute-path environment
      variables — the only channel a spawn inherits (`runner.ts:106-113`, `:185`), since its cwd
      is the managed repo (`sessions.ts:296`). (file)
- [ ] Each script declares what it expects of its spawn — `--resume` present or absent, and
      whether the system prompt carries the first-spawn refine seed (`sessions.ts:369-371`) — and
      a spawn whose claimed script does not match fails loudly, so an unplanned same-role spawn is
      caught where it drifts rather than at the end of the directory. (live)
- [ ] With no script directory configured the stub emits a bare init and a flagless result; with
      one configured but no script for its role and ordinal, or an unreadable script, it exits
      non-zero **before** init and the orchestrator surfaces `SessionSpawnError`
      (`runner.ts:74-91`) without hanging the dispatcher slot. (live)
- [ ] The stub's tool client reads `result.isError` and the error text rather than catching (a
      rejected call resolves — Approach), logs every refusal, retries only the two not-ready
      refusals — "session is not initialized yet" (`src/server/mcp/server.ts:100-107`) and "no
      adversary round is running for this story" (`src/server/services/gate.ts:366`) — on a
      bounded backoff, and exits non-zero on any other error text. (file)
- [ ] A probe whose script calls `flag_risk` with an invalid payload records the fatal refusal in
      the log and fails the episode instead of retrying it. (live)
- [ ] `harness/episode/` writes the scratch repo, its board fixture, a scratch `helm.config.json`
      and a `dist/client` symlink, starts the orchestrator from that cwd, and never reads or
      writes the developer's `helm.config.json`. (file)
- [ ] The board fixture's story carries a brief that passes `checkReadyGate`
      (`src/board/transitions.ts:22-47`) and **no valid `gate` verdict**, so `requestReady` starts
      an attempt instead of short-circuiting to Ready (`gate.ts:152-159`). (file)
- [ ] After setup, every state change the driver makes goes through the orchestrator's API —
      `session.spawn`, `story.move`, proposal resolution, `gate.resolveFlag`, over
      `POST /rpc/<route>/<procedure>` — with no direct write to the scratch board's files, and
      every assertion reads a WS channel snapshot or an on-disk file. (file)
- [ ] Each non-flagless episode spawns the refine chat and waits for its `closed` frame on the
      `session` channel before starting the gate, so `routeFlags` (`gate.ts:245-254`) routes
      instead of conceding and `messageSession` never returns `SESSION_BUSY`. (file)
- [ ] Every episode declares its expected spawn sequence and the driver fails it when the log's
      sequence differs — including the second adversary round an accepted fix always buys while
      `rounds.length < 2` (`gate.ts:308-315`). (file)
- [ ] Every stub spawn writes a start entry and a completion entry carrying its exit code, and the
      driver fails the episode on a non-zero exit **or a missing completion** (a killed or crashed
      stub logs none), rather than letting the flagless `writePass` path (`gate.ts:237-241`) read
      as a clean gate pass. (live)
- [ ] `tsconfig.json`'s `include` covers `harness`, and `pnpm check` passes. (command)
- [ ] The flagless episode drives a refining story into Ready with a recorded `gate` verdict —
      today's behavior, unbroken. (live)
- [ ] The one-flag episode drives a round whose flag appears on the `gate` channel with its title
      and detail, routes to the refine session, settles `fixed` when the driver accepts the fix
      proposal with a body change the driver asserts, and lands in Ready after the flagless second
      round. (live)
- [ ] The contested episode leaves a contested flag rendering its `FlagWidget` with the
      counter-argument in the drawer while the story stays in Refining; the driver dismisses it
      through `gate.resolveFlag`, the override is recorded, and the story moves to Ready with the
      brief unchanged (`gate.ts:503-509`). (live)
- [ ] The two-round episode reaches the `exhausted` phase — two flagged rounds, each fix accepted
      with an asserted body change — with the panel showing the round history and the card its
      gate badge. (live)
- [ ] The concession probe's refine script ends its turn without answering, leaving that round's
      open flags auto-contested with no counter-argument (`concedeOpenFlags`, `gate.ts:278-284`,
      via `onClosed` `:526-542`) — the path this harness exists to make reachable. (live)
- [ ] The log across a full episode shows exactly the declared spawns, every one of them the stub.
      The meter is reported alongside but is not the evidence, since the stub authors its own
      `usage` (`src/sessions/events.ts:44-88`). (live)
- [ ] `.helm/knowledge/architecture/claude-integration.md` §Verifying without burning the pool
      describes the harness's two halves, where they live, the two environment variables, the
      scratch-cwd recipe, and that board-tool calls make flagged rounds and exhausted attempts
      zero-cost — instead of a one-off trick; `CLAUDE.md`'s "Where things are" lists `harness/`. (file)

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
  against the running scratch app.
- Replacing real-CLI verification: behavior only the live CLI shows (compaction, refusals,
  rate-limit events) still needs a real spawn.
- Running the harness in CI or wiring it into `pnpm check`: it is a tool a person runs.

## Open questions
