---
id: 005-06
status: ready
depends: []
gate: { passed: 2026-07-30T12:07:12.267Z, brief: 611954233a619bbc, overrides: [] }
sessions: {}
---
# One refine turn per story

## Goal

A story runs at most one refine turn at a time, enforced where every refine spawn already passes
rather than by the coincidence that keeps it true today. Today the gate's turn and the user's turn
share one session id, so `messageSession`'s `live.has` check (`src/server/services/sessions.ts:186-191`)
serializes them in both orders; the moment a story can carry a second refine id the invariant is
gone, and nothing else replaces it — `known` is never pruned (`:166`) so a superseded id stays
messageable, `resolveAttach` checks only status (`:462-481`), and `contestGateFlag` and
`gateFixProposed` authorize on phase alone (`gate.ts:448-476`, `:502-526`), so a second concurrent
turn could answer the round the first is working. 005-02 needs that second id; this story makes the
invariant real first, so the reseed inherits a guarantee instead of breaking one.

The harness cannot drive any of it today: `stubStepSchema` is exactly `emit`/`call`/`exit`
(`harness/stub-claude/script.ts:6-14`) and every board tool returns immediately, so no episode can
hold a refine turn open at the moment a second spawn arrives. A hold-open step is the other half
of this story — the instrument, without which the guard ships graded by reading.

Split out of 005-02 at its third gate round, when three of that round's seven flags landed on the
guard rather than on the reseed: its release sites, its interaction with `messageSession`'s
double-spawn stale path, and the park it shares with the unmarked path. The epic's own thesis,
applied to itself.

## Approach

Measured at `48529cc`:

- **The guard's home has two release sites already — and a rejection path neither covers.**
  `spawnTracked` (`src/server/services/sessions.ts:268-358`) is synchronous from entry through the
  process spawn; `registerSpawn` runs at `:287`, the synchronous catch at `:323-328` releases by
  hand because a sync throw means the done handler never registers, and the done continuation
  (`:335-356`) releases at `:336` **before** the closed listeners fire (`:344-346`). But `done`
  awaits `events.once(child, "close")` (`runner.ts:223-224`), which attaches its own rejecting
  `error` listener: a spawn ENOENT emits `error` **then `close` with code `-2`** (measured — the
  close is not starved), yet `once` rejects first, the `.then` continuation is skipped, and
  `rejectStarted` (`:235`), inside the same rejected body, never fires — today a leaked MCP
  binding and a hung caller. And `spawnTracked` is the funnel for *every* kind: the adversary
  (`gate.ts:281`), the grader (`grader.ts:279`), and every run segment (`sessions.ts:421`) carry
  the same `{type:"story"}` attach a story-keyed guard would key on, so an unconditioned release
  would let their closes free a live refine turn's key.
- **A pre-init spawn has no kill path, and the group kill is a no-op for chat spawns.**
  `killSession` resolves through `live` (`sessions.ts:230-244`), which is keyed only in the
  `started.then` continuation (`:329-334`); teardown kills only `live.values()`. A refine spawn
  that hangs before `system/init` would hold a story key indefinitely. The repo bounds this window
  for the one kind with an owner: `runs.ts:66` `INIT_TIMEOUT_MS = 60_000`, enforced by `raceInit`
  (`:684-699`) — but its kill is `killProcessGroup`, correct there only because run spawns pass
  `detached: true` (the sole such site, `sessions.ts:430`) and lead their own group. A refine
  spawn is not detached, so its pid is no pgid: `killProcessGroup` would probe
  `process.kill(-pid, 0)`, get ESRCH, and return having signalled nothing
  (`src/server/process-group.ts:37-38`). The chat-kind kill primitive is `child.kill()` — plain
  single-pid SIGTERM — the call `killSession` already uses at `sessions.ts:243`.
- **The double-spawn caller survives on ordering today, not construction.** A spawn failure's
  rejection is minted inside the runner's `done` body immediately before `done` resolves, so when
  the error reaches `runTurn`'s `await tracked.child.started` (`sessions.ts:375`) the release
  continuation is merely *queued*. `messageSession`'s stale path (`:195-227`) re-enters `runTurn`
  only after awaiting `readCardRaw` (`:216`) — the accident that keeps it alive. Stale itself
  needs `exitCode === 1` plus the `No conversation found with session ID` stderr line
  (`runner.ts:93`, `:232`), and its recovery test at `:204` matches on `SessionSpawnError` — a
  foreign error replacing it would skip the reseed. For a resume, `runTurn` reaches `spawnTracked`
  with no intervening await (`seedFor` is skipped, `:370`) — the fact the drain's ordering proof
  stands on.
- **Today a second refine spawn is not refused at all.** `messageSession`'s `live.has` check
  (`:186-191`) covers only the same id and only post-init; `session.spawn` for refine checks only
  status (`resolveAttach`, `:462-481`), spawns a concurrent turn, and `persistAttach` (`:583-601`)
  overwrites `sessions.refine`. The teardown clears `live`/`known`/`interrupted` (`:631-637`); a
  guard set joins that list.
- **The gate's park is keyed to a session id the guard stops guaranteeing, and its retry timing is
  load-bearing.** `pendingFlags` is written at exactly `gate.ts:330` and cleared at exactly
  `:595-596`, inside an `onClosed` branch requiring an id match (`:594`) after an early return on
  id-less closes (`:592`). `routeFlags` mutates `refineSessionId` and the phase (`:319-320`)
  *before* knowing the send's outcome, and re-parks only after two awaits (`:312`, `:322-332`).
  When the guard — not `live.has` — refuses in the pre-init window, the in-flight turn closes
  under a different id and an id-matched retry never fires: at HEAD the race spawns a concurrent
  turn but completes; the guard alone would convert it into a permanent hang. The heal must land
  with the guard, and it must own the flag.
- **Two server-internal `messageSession` callers have no toast to fall back on.** `dispatchResume`
  (`proposals.ts:748-760`) guards with `isSessionLive` — same-id only — and is called at `:269`,
  `:285`, `:379`, always *after* the pending record is deleted and broadcast, so a guard 409 would
  fail the RPC with the resolution already consumed. The held-resume listener bails on id-less
  closes (`:770-771`), deletes the entry before an async send, and swallows failures; and
  `dispatchResume` appends to the same key (`:753-757`) — two writers unless a merge rule is
  named.
- **The UI paths do reach a toast.** `sendChatMessage` catches any send failure, removes the
  echoed message, clears `busy`, and toasts `error.message` (`session-store.ts:470-496`);
  `spawnRefineSession` toasts likewise (`:519-545`). The composer clears the draft before the call
  (`chat-pane.tsx:159-165`) — pre-existing for every failed send.
- **The stub keeps a resumed id** (`stub.ts:75`), so `persistAttach`'s write is skipped on every
  stub resume (`sessions.ts:378-384`): divergent ids under the stub come only from fresh
  `session.spawn` uuids — enough to drive the proposals hold and drain, not the gate's divergent
  park. The stub emits `system/init` before running steps (`stub.ts:76`, `:113-134`), so it can
  hold a turn open but can never hang pre-init, fake a spawn failure, or produce a stale one. Exit
  codes 2 and 4 are taken (`:11`, `:14`); the scripts dir arrives as `HELM_STUB_SCRIPTS` (`:16`).
  `claimScript` returns at the first missing ordinal **before creating any `.claim` marker**
  (`script.ts:46-48`), so a failed claim leaves the ordinal claimable.
- **The harness observables are ready, with one gap.** The observer's default deadline is 45s
  (`observer.ts:36`); `closed` frames carry `exitCode` (`events.ts:164-171`); `start` entries
  carry `parsed.resume` (`argv.ts:15-35`); `verifySpawnLog` demands the exact start sequence
  (`driver.ts:252-283`); the durable gate record is asserted from the story file via
  `waitForRecord` (`driver.ts:87-106`), the pattern the sibling gate-history episodes use. The
  gap: `RpcError` stores neither status nor body (`rpc.ts:2-5`), and no existing episode catches
  an RPC rejection. Twelve episodes exist, three halting, so `all` runs nine (`run.ts:17-19`).
- **The doc sentence the wait step falsifies**: claude-integration.md §Verifying without burning
  the pool says the driver "pre-writes every script of the episode" (`:122`).

Changes:

1. **The guard, at the funnel every refine spawn passes.** `sessions.ts` gains a module-level
   story-keyed set, checked and registered at `spawnTracked` entry — refine kind with a story
   attach only, before `registerSpawn`, no await between check and set, so the pre-init window is
   covered by construction. A hit throws `SESSION_BUSY` (409, story-scoped message). One
   `release()` closure wrapping `releaseSpawn` replaces both existing call sites (`:326`, `:336`)
   — and it deletes the story key **only if this spawn acquired it**, a boolean captured at
   acquire, so adversary, grader, and run-segment closes on the same story can never free a live
   refine turn's key. The release invariant rests on change 3's settlement guarantee. The teardown
   clears the set.
2. **A guarded spawn's init is bounded** (surface growth, named plainly: the guard makes a hung
   pre-init spawn a story-wide lock with no kill path, so the bound is the guard's escape hatch).
   When a spawn acquires the story key, `spawnTracked` arms a 60s init timer — the value
   `runs.ts:66` already chose — cleared when `started` settles; on expiry it calls
   **`child.kill()`**, the plain single-pid SIGTERM `killSession` already uses for the chat kinds
   (`sessions.ts:243`). `killProcessGroup` is wrong here and would be a silent no-op: a refine
   spawn is not detached (`detached: true` exists only at the run-spawn site, `:430`), so its pid
   is no pgid and the group probe ESRCH-returns having signalled nothing
   (`process-group.ts:37-38`) — the `raceInit` reference is the timer-plus-`SPAWN_FAILED` shape
   only, never its kill. The resulting close runs the normal continuation: release,
   `rejectStarted`, `SPAWN_FAILED` at the caller. Said plainly: the release is close-dependent by
   construction, so "cannot hold the key indefinitely" is exactly as strong as that one SIGTERM
   reaching the child — a child that ignores it keeps the key, the same trust `killSession`
   already places. The stub inits instantly, so this is graded by reading.
3. **`done` settles only on `close`** (`src/sessions/runner.ts`). `events.once(child, "close")` —
   whose own error listener is the sole defect — is replaced by a plain promise resolved by the
   `close` event, with a separate `error` handler that folds the error's text into `stderr`. A
   spawn ENOENT then flows through the real close (`-2:null`, measured), the body completes,
   `rejectStarted` fires through the existing `init === undefined` path, and the caller gets a
   `SessionSpawnError` carrying the true exit code. A post-init `error` (e.g. `kill` EPERM on a
   live child) records text and nothing else — no release, no `live.delete`, no `closed` frame for
   a turn that hasn't ended.
4. **The park heals on any close, and `routeFlags` owns the flag** (`gate.ts`, pulled from 005-02
   — the guard mints the divergent-id park, so the heal ships with it). `pendingFlags` is written
   by `routeFlags` alone: true only in its `SESSION_BUSY` catch, cleared at every other exit (the
   successful send, the no-session concession, the failure concession) — true exactly while flags
   await a route. `onClosed` never writes it: while true, every close — id-less closes included,
   ahead of today's `:592` return — appends one link to a per-attempt **serial retry chain** (a
   new `Attempt` field; a link runs `routeFlags` only if the flag is still set and the attempt
   still current) and `continue`s past the concede branch. A parked round can never be conceded
   unrouted, and a holder closing during an in-flight retry appends the link that heals the
   re-park. 005-02's brief loses this change; it inherits it as landed.
5. **Held resumes become guard-aware, with one writer at a time** (`proposals.ts` — same reason it
   lands here). `dispatchResume` keeps its `isSessionLive` fast path and additionally catches
   `SESSION_BUSY`, holding the message instead of failing a consumed resolution. The close
   listener triggers a drain on **every** close, `sessionId: undefined` included (today's
   `:770-771` return goes — the drain never keys on the closed id), so a resume held because a
   pre-init-dying spawn owned the key is woken by that very close. The drain is serial via an
   in-flight guard, **not** a promise chain: when idle it is invoked synchronously from the
   listener, so its first send reaches `spawnTracked` before any await (a resume skips `seedFor`,
   `sessions.ts:370`) — inside the listener loop, which is what lets an episode falsify
   release-before-listeners. A close mid-drain queues exactly one more. Each entry is taken out,
   sent, and on `SESSION_BUSY` re-held by **prepending** the taken messages ahead of anything
   appended to that key while the send was in flight. Two held ids on one story drain correctly:
   the first entry's successful spawn guarantees the later close that drains the refused second.
6. **Double-spawn safety by construction, not ordering.** `runTurn` catches the `started`
   rejection, awaits `tracked.done` with its settlement ignored (`.catch(() => {})` — belt
   against a throwing closed listener), and rethrows the original error: every error it surfaces
   implies the release ran, and a listener throw cannot replace the `SessionSpawnError` that
   `messageSession`'s stale test (`:204`) depends on. `messageSession` itself is byte-untouched.
7. **The stub `wait` step.** `stubStepSchema` gains
   `{ t: "wait", sentinel: string, timeoutMs?: number }`: poll (~50ms) for the sentinel — relative
   paths resolve against `HELM_STUB_SCRIPTS` — and proceed when it appears; on timeout, close the
   MCP client, log the exit, die at `WAIT_TIMEOUT_EXIT = 5` (distinct from 0/1/2/4). Default bound
   30s — under the observer's 45s — schema-capped overrides up to 600s for halting episodes.
8. **Four episodes.** `RpcError` gains `status` and `body` fields so refusals are assertable.
   - `refine-turn-guard` (unattended): `refine-1` raises an `update_brief` proposal (no
     `resolves`) and closes as id A; a fresh `session.spawn` starts a `wait`-scripted turn F (new
     uuid). While F is live: a second `session.spawn` gets 409 `SESSION_BUSY`, no `start` entry,
     `sessions.refine` unchanged; resolving the proposal with reject succeeds and holds. The
     sentinel closes F; the drain — synchronous first hop — sends the held resume, whose spawn
     claims `refine-3` with `parsed.resume` = A: an inverted release or an id-keyed flush fails
     the episode.
   - `refine-turn-park` (unattended): `adversary-1` raises a flag then `wait`s; a
     `session/message` puts a `wait`-scripted refine turn live; releasing the adversary routes
     flags into it — park (phase holds `refine`, no fourth `start`, flag open); releasing the
     refine sentinel closes the turn, the chained retry resumes it (`refine-3`, flags prompt), the
     turn closes unanswered — concession, flag `contested`, phase `review`, **and the record lands
     on disk**: `gate.rounds` in the story file. The retry's id-independence is not falsifiable
     here (the stub keeps resumed ids) and rides the (file) criterion.
   - `refine-turn-failure-release` (unattended): `refine-1.json` withheld — the spawn dies
     pre-init (`claims: false`, `NO_SCRIPT_EXIT`, no `.claim` marker left); the episode **then
     writes `refine-1.json` mid-run** (`wait`, `timeoutMs` ~500, sentinel never written) and
     respawns immediately — release-on-pre-init-death; that turn times out at `WAIT_TIMEOUT_EXIT`
     and a third spawn succeeds — release-on-timeout-close. No claim about change 6, graded by
     reading.
   - `refine-turn-live` (halts, run by name): a `wait`-scripted turn with a long `timeoutMs` is
     live at the halt; the operator reloads the drawer, sends a message, sees the `SESSION_BUSY`
     toast with the echoed line removed and the composer still usable; Enter releases the
     sentinel. Honest limit: this exercises the same-id server refusal; the cross-id refusal gets
     a UI-reachable path only in 005-02.
9. **One doc sentence corrected**: claude-integration.md `:122` gains episode-authored mid-run
   files (scripts, sentinels) and the `wait` step.

## Blast radius

- `src/server/services/sessions.ts` — the guard set, the check-and-register at `spawnTracked`
  entry, the acquire-conditioned `release()` closure replacing the two `releaseSpawn` call sites,
  the guarded-spawn init timer, `runTurn`'s started-catch awaiting `tracked.done` with its
  settlement ignored, and the teardown clear. `messageSession`, `spawnSession`, `resolveAttach`,
  `seedFor`, `persistAttach` byte-untouched; adversary, grader, and run-segment spawns pass
  through unguarded and never release the key.
- `src/sessions/runner.ts` — `done` resolves only on the `close` event; a plain `error` handler
  folds the error text into `stderr`. Nothing else in the spawn plumbing changes.
- `src/server/services/gate.ts` — no longer untouched, said plainly: `Attempt` gains the serial
  retry-chain field; `routeFlags` becomes the sole writer of `pendingFlags`; `onClosed`'s
  `pendingFlags` branch becomes an id-independent chain append ahead of the
  undefined-`sessionId` return. `evaluate`, `persistGate`, the tool entries, and every abort path
  unchanged.
- `src/server/services/proposals.ts` — `dispatchResume` holds on `SESSION_BUSY`; the close
  listener becomes an every-close serial drain (synchronous first hop, prepend merge rule). The
  resolution RPCs and stores unchanged.
- `harness/stub-claude/script.ts` — the `wait` step in `stubStepSchema`.
- `harness/stub-claude/stub.ts` — the `wait` execution and `WAIT_TIMEOUT_EXIT`.
- `harness/episode/rpc.ts` — `RpcError` gains `status` and `body` fields; message unchanged.
- `harness/episode/episodes.ts` — four new episodes; `EPISODES` grows 12 to 16, halting 3 to 4.
- `harness/episode/run.ts` — untouched: the filter picks up the three unattended episodes.
- `.helm/knowledge/architecture/claude-integration.md` — the `:122` script sentence.
- Behavioral reach: `session.spawn` for refine on a story with a turn in flight now returns 409
  instead of silently spawning a concurrent turn and overwriting `sessions.refine`; a pre-init
  message is refused instead of spawning a duplicate; both surface as the existing toast. A
  resolution during another turn's flight delivers its outcome after that turn closes instead of
  failing post-consumption. Parked gate flags retry on any close. A spawn whose child emits
  `error` surfaces `SPAWN_FAILED` with its true exit code instead of hanging the caller; a refine
  spawn that never inits is killed at 60s instead of locking its story. No RPC contract, WS
  shape, schema, or app change.

## Acceptance criteria

- [ ] `spawnTracked` in `src/server/services/sessions.ts` refuses a refine spawn for a story whose
      refine turn is in flight with `SESSION_BUSY` (409, story-scoped message), via a story-keyed
      register checked and set with no await between, before `registerSpawn`, refine-kind
      story-attach spawns only — covering the pre-init window by construction; a single release
      closure wrapping `releaseSpawn` replaces both existing call sites (`:326`, `:336`) and
      deletes the story key **only when this spawn acquired it** (a boolean captured at acquire),
      so adversary (`gate.ts:281`), grader (`grader.ts:279`), and run-segment (`sessions.ts:421`)
      closes on the story never release it; the service teardown clears the register. (file)
- [ ] A spawn that acquires the story key arms an init timer (60s, the `runs.ts:66` value) cleared
      when `started` settles; on expiry it calls **`child.kill()`** — the single-pid SIGTERM
      `killSession` uses for chat kinds (`sessions.ts:243`), never `killProcessGroup`, which
      ESRCH-returns without signalling a non-detached spawn (`process-group.ts:37-38`;
      `detached: true` exists only at the run site, `:430`) — and the resulting close runs the
      normal continuation: release, then `SPAWN_FAILED` at the caller. The bound is exactly as
      strong as that SIGTERM reaching the child, the same trust `killSession` places. The stub
      inits instantly; graded by reading. (file)
- [ ] `spawnSessionProcess`'s `done` in `src/sessions/runner.ts` settles **only on the `close`
      event**: the `events.once` await is replaced by a plain close-resolved promise, a separate
      `error` handler folds the error's text into `stderr`, and a spawn ENOENT therefore surfaces
      through the real close (code `-2`) as a `SessionSpawnError` with the true exit code — while
      a post-init `error` on a live child records text only: no release, no `closed` frame, no
      `live` mutation. Graded by reading (episodes put the stub on `PATH`). (file)
- [ ] `runTurn` catches the `started` rejection, awaits `tracked.done` with its settlement ignored
      (`.catch(() => {})`), and rethrows the original error — every error it surfaces implies the
      release ran, and a throwing closed listener cannot replace the `SessionSpawnError` that
      `messageSession`'s stale test (`:204`) matches on. The stale double-`runTurn` path is safe
      by construction; graded by reading. (file)
- [ ] In `src/server/services/gate.ts`, `routeFlags` is the sole writer of `pendingFlags`: true
      only in its `SESSION_BUSY` catch, cleared at every other exit, so the flag is true exactly
      while flags await a route. `onClosed` never writes it: while true, every close — id-less
      closes included, ahead of today's `:592` return — appends one link to the attempt's serial
      retry chain (a link runs `routeFlags` only if the flag is still set and the attempt still
      current) and skips the concede branch, whose id match is unchanged. A parked round cannot be
      conceded unrouted, and a holder closing during an in-flight retry appends the link that
      heals the re-park — including the divergent-id park the stub cannot produce
      (`stub.ts:75`). (file)
- [ ] `dispatchResume` in `src/server/services/proposals.ts` catches `SESSION_BUSY` and holds the
      message, so `proposal/resolve`, `answerQuestion`, and `settleDecision` cannot fail with the
      resolution already consumed; the close listener triggers the drain on **every** close,
      `sessionId: undefined` included; the drain is serial via an in-flight guard — when idle it
      is invoked synchronously from the listener so its first send reaches `spawnTracked` inside
      the listener loop (a resume skips `seedFor`, `sessions.ts:370`), and a close mid-drain
      queues exactly one more — and on `SESSION_BUSY` re-holds by prepending the taken messages
      ahead of anything appended while the send was in flight; other failures log as today. (file)
- [ ] `RpcError` in `harness/episode/rpc.ts` carries `status` and `body` as readonly fields; the
      refusal assertions below use them (`status === 409`, `body` containing `SESSION_BUSY`). (file)
- [ ] `stubStepSchema` in `harness/stub-claude/script.ts` gains
      `{ t: "wait", sentinel, timeoutMs? }`; `stub.ts` polls for the sentinel (relative paths
      resolve against the `HELM_STUB_SCRIPTS` dir) and on timeout exits at `WAIT_TIMEOUT_EXIT = 5`,
      distinct from every existing code, default bound 30s — under the observer's 45s — and the
      schema capping explicit overrides at 600s. Existing steps unchanged. (file)
- [ ] Episode `refine-turn-guard`: with a fresh-spawned `wait`-scripted refine turn live (a new
      uuid, so `sessions.refine` diverges from the proposal turn's id), a second `session/spawn`
      rejects with `RpcError` status 409 and `SESSION_BUSY` in the body, adds no `start` entry,
      and leaves `sessions.refine` unchanged; resolving the pending proposal with reject succeeds
      during the live turn and spawns nothing; after the sentinel closes the turn, the drained
      resume spawn claims `refine-3` with `parsed.resume` equal to the proposal turn's id and
      exits 0 — issued synchronously inside the closed listener, so an inverted release or an
      id-keyed flush fails the episode. Declared spawns exactly `refine-1` 0, `refine-2` 0,
      `refine-3` 0; rounds 0. (live)
- [ ] Episode `refine-turn-park`: with the adversary's verdict held open by its own `wait` step, a
      `session/message` puts a `wait`-scripted refine turn live before flags route; on routing the
      gate parks — phase holds `refine`, the flag stays open, no fourth `start` entry; releasing
      the refine sentinel closes the turn and the chained retry's resume spawn (`refine-3`,
      claiming the flags prompt) follows it in the log, closes unanswered, and settles the round:
      flag `contested`, phase `review`, **and the story file's frontmatter records it** —
      `gate.rounds` holds round 1 with the flag `contested`, asserted from disk via
      `waitForRecord`. Declared spawns exactly `refine-1` 0, `adversary-1` 0, `refine-2` 0,
      `refine-3` 0; rounds 1. (live)
- [ ] Episode `refine-turn-failure-release`: with `refine-1.json` withheld, the first spawn dies
      pre-init (`claims: false`, `NO_SCRIPT_EXIT`), leaving no `.claim` marker
      (`script.ts:46-48`); the episode then writes `refine-1.json` into `ctx.scratch.scriptsDir`
      (`wait`, `timeoutMs` ~500, sentinel never written) and respawns immediately after the
      rejection — the spawn succeeds and claims ordinal 1, grading release-on-pre-init-death; that
      turn times out with its `closed` frame carrying exit 5, and a third spawn succeeds —
      release-on-timeout-close. Declared spawns exactly: refine `claims: false` 2, `refine-1` 5,
      `refine-2` 0; rounds 0. (live)
- [ ] Episode `refine-turn-live` (run by name; it halts): at the halt a `wait`-scripted refine
      turn is live; reloading the drawer and sending a message shows the `SESSION_BUSY` toast, the
      sent line disappears from the transcript, and the composer accepts further input; after
      Enter the sentinel closes the turn cleanly (exit 0). (live)
- [ ] `node harness/episode/run.ts all` passes 12/12 — the nine existing unattended episodes plus
      `refine-turn-guard`, `refine-turn-park`, `refine-turn-failure-release`; the halting four
      (`contested`, `exhausted`, `gate-history-cold`, `refine-turn-live`) each run by name. (live)
- [ ] `pnpm check` passes. (command)
- [ ] `.helm/knowledge/architecture/claude-integration.md`'s "pre-writes every script" sentence
      (`:122`) covers episode-authored mid-run files and the `wait` step. (file)

## Out of scope

- Everything 005-02 still keeps: the reseed marker, `spawnChatTurn`, `gateFlagsPrompt` overrides,
  the settle continuation, and the `gate-reseed-*` episodes. The id-independent park retry is no
  longer among them — it lands here, and 005-02's brief drops it.
- A stub-drivable stale failure, child `error` event, or pre-init hang, and a stub-drivable
  divergent-id resume (`stub.ts:75` keeps the id): these paths are made safe by construction and
  graded by reading, stated in their criteria.
- Bounding a turn that hangs *after* `system/init` — it is visible in `live` and killable through
  `killSession`, today's surface.
- Any app change: draft preservation on a refused send, a story-busy affordance in the drawer, or
  new toast copy beyond the server's message text.
- Guarding the other chat kinds (`define`, `shape`) or the run lifecycle; refusing a fresh refine
  spawn that supersedes an *idle* session (today's overwrite behavior stays).
- Pruning `known`, and any change to `messageSession`, `resolveAttach`, or the gate's
  authorization checks (`contestGateFlag`, `gateFixProposed`).

## Open questions

- [x] The halting `refine-turn-live` episode stays in this story: the user-visible refusal is this
      story's own concern, the episode reuses the `wait` step, and 005-02's halt carries its own
      check.
- [x] A busy resolution's outcome prompt is held and drained on the next close, rather than
      `proposal/resolve` refusing up front: a resolution the user already made never bounces, and
      the hold reuses the machinery that already exists for the same-id case.
