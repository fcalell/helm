---
id: 005-02
status: backlog
depends: [005-01, 005-06]
sessions: {}
---
# Reseed refine on retry

## Goal

A re-requested gate after exhaustion runs its fix rounds in a fresh refine session seeded from
the story file, replacing the resume of `sessions.refine`. The resumed transcript hurts twice:
its replay re-enters the session on every fix round, so the per-round price grows with the
rounds already spent, and it carries sunk-cost bias, the 004-02 session kept reintroducing the
supersession design its own transcript had argued for even after edit resolutions removed it
([loop-findings](../../../research/loop-findings.md) §004 loop). What broke that loop was a
fresh read of the brief with no chat history. The seed is the durable state: the brief body, the
open questions, and the attempt's override register. Anything that survives only in chat history
was never durable, the files-as-truth rule the board already lives by
([board-storage](../../../knowledge/architecture/board-storage.md)). Within an attempt the
session still resumes; the reseed boundary is the user's retry, where exhaustion has already
proven the current context stuck.

## Approach

Measured at `8c15777`:

- **The retry path never touches the session.** `requestReady` (`src/server/services/gate.ts:196-251`)
  handles a user retry of an exhausted attempt by calling `enqueueRound` on the *same* object
  (`:232-235`); a fresh `Attempt` is minted whenever the map holds none (`:238-248`) — after every
  restart and every abort — with `overrides: []` and no memory of the story's recorded rounds, even
  though `current` (the fresh read at `:202`) carries them: 005-01 made `gate.rounds` durable
  (`src/board/schema.ts:84-99`). An attempt exhausts only past the two-round cap
  (`evaluate`, `gate.ts:376-380`), so exhaustion always leaves **at least two** recorded rounds,
  while `gate.rounds` also accumulates one round from any aborted or interrupted attempt — the
  record alone does not distinguish "stuck" from "interrupted once".
- **`routeFlags` is the one resume site, and its id assignment precedes its await.** It reads
  `story.frontmatter.sessions.refine` (`gate.ts:313`), concedes every flag when the story carries
  none (`:314-317`), sets `attempt.refineSessionId = refineId` at `:319` **before** awaiting
  `messageSession` (`:322-325`) so an instant close still matches `onClosed`'s key (`:594`);
  `SESSION_BUSY` parks the flags (`:329-332`) for the `pendingFlags` retry (`:595-598`), and any
  other failure concedes (`:333-336`).
- **Today's one-refine-turn-at-a-time invariant is an accident of the shared id.** Gate turn and
  user turn both run under `sessions.refine`, so `messageSession`'s `live.has` check
  (`sessions.ts:186-191`) serializes them in both orders. Two ids for one story break it:
  `known` is never pruned (`:166`), so a superseded id stays messageable; `resolveAttach` checks
  only status (`:462-481`); and `contestGateFlag` / `gateFixProposed` authorize on phase alone
  (`gate.ts:448-476`, `:502-526`), so a second concurrent refine turn could answer the current
  round. The window is real: `spawnSession` resolves only after `runTurn` has awaited
  `child.started` *and* `persistAttach`'s queued write (`:375-384`), and until that write lands the
  drawer (`card-drawer.tsx:117-120`) and any user send still name the old id.
- **An atomic guard is buildable where every refine spawn already passes.** `spawnTracked`
  (`sessions.ts:268-358`) is synchronous from entry through the process spawn (its MCP registration
  at `:287` already is), so a check-and-register keyed by story has no await between test and set;
  its done continuation (`:335-356`) is where a release runs before the closed listeners fire.
- **A phase can leave `refine` mid-turn only with zero open flags.** `evaluate` returns on any open
  flag at `:355` before either flip to `review` (`:357`, `:369`), and the user RPCs reachable
  mid-turn (`gateBriefEdited:496`, `gateFixRejected:540`, `resolveGateFlag:572,:588`) all route
  through it. So if the phase moved off `refine` while a reseeded turn ran, no open flag remains
  and a turn-end concession is vacuous.
- **`runTurn` already exposes completion.** It returns `{ sessionId, done }` (`:360-389`);
  `spawnSession` merely discards `done` (`:110-132`). A gate that owns the turn's end must not
  `await` it inside `runRound`, though: `runRound` holds a dispatcher slot (`dispatch`, `:255`),
  and chat kinds bypass the queue by design (session-kinds.md §Registry), so the settle must ride
  a continuation, never block the slot.
- **`messageSession` reseeds only when the transcript is *gone*** (`sessions.ts:204-227`): a live
  transcript always replays — the replay-price and sunk-cost costs of loop-findings.md §004 loop.
- **The override register is the one seed piece the file lacks.** `attempt.overrides` entries are
  already `"title: reason"` strings (`gate.ts:570`); `adversaryPrompt` carries them
  (`prompts.ts:124-143`); durable `gate.overrides` is pass-only (`gate.ts:389-394`), and recorded
  rounds keep dismissed titles only (`schema.ts:78-82`). `gateFlagsPrompt` (`prompts.ts:148-156`)
  has exactly one caller (`gate.ts:322`).
- **Chat content is not a stub observable; the session id is — on one channel only.** The pane
  hydrates from the CLI transcript (`chat-pane.tsx:142` → `session.transcript` → `readTranscript`,
  `src/worker/routes/session.ts:43-45`); the stub writes no transcript and emits two frames
  (`frames.ts:22-36`, `:47-66`). The stub's `start` log entry carries argv and env, never the
  minted id (`log.ts:10-25`; `stub.ts:75` mints it after the entry is written) — but the session
  channel's `closed` frames carry it, and the driver already matches on them (`driver.ts:120-122`).
- **The stub cannot hold a turn open.** `stubStepSchema` is exactly `emit`/`call`/`exit`
  (`script.ts:6-14`); every board tool returns immediately. A live refine turn at flag-routing
  time is undrivable without a new step.
- **Script claiming supports failure-then-success by ordinal.** `claimScript` re-scans per spawn
  and fails at the **first missing ordinal** (`script.ts:43-48`), so a pre-written `refine-3.json`
  never masks a withheld `refine-2.json`; scripts are plain JSON files (`driver.ts:240-250`), and
  `writeScripts` is module-private, so a mid-run script is the episode's own `writeFileSync` into
  `ctx.scratch.scriptsDir`. claude-integration.md `:122` currently states the driver "pre-writes
  every script", which a mid-run write falsifies. A missing script is the one pre-init death
  (`NO_SCRIPT_EXIT`, `stub.ts:70-72`; a script `exit` step dies after init, `:75-76`).
  `verifySpawnLog` demands an exact declaration list (`driver.ts:252-283`).
- **`run.ts all` runs the unattended episodes only** (`run.ts:17-19`): nine of today's twelve;
  `contested`, `exhausted`, `gate-history-cold` run by name (`:26-31`).
- **Two committed episodes fixture ≥ 2 recorded rounds and will meet the bounded marker**:
  `gate-history-block-style` on the default story (`episodes.ts:540`) and `gate-history-cleared` on
  `SECOND_ID` (`:478`) — both fixture `FIXTURE_ROUNDS`, two rounds (`:401-404`).
  `gate-history-restart` settles exactly **one** round before its restart (`:447-451`), under the
  bound.

Changes:

1. **The attempt knows its refine context is stale, and "stale" means the exhaustion bar.**
   `Attempt` gains a reseed marker, set in exactly two places: the exhausted-retry branch
   (`:232-235`), and the fresh-attempt mint (`:238-248`) **only when the just-read story records at
   least two rounds** — the same two-round cap that defines exhaustion, so the durable trigger and
   the in-memory one demand the same evidence. A re-request after a restart that interrupted a
   single round resumes today's session and keeps the user's conversation; only a gate that already
   spent what an attempt is allowed to spend reseeds. A first-ever gate sets no marker.
2. **The marked branch spawns fresh under a story-scoped turn guard, and owns the turn's end.**
   - **Guard** (`src/server/services/sessions.ts`): `spawnTracked` gains a synchronous
     one-refine-turn-per-story register — a refine spawn attached to a story with a refine turn in
     flight throws `SESSION_BUSY` before any process spawns, registered with no await after the
     check and released in the done continuation before the closed listeners run. Every refine
     spawn funnels through it, so both orders lose cleanly: the gate's spawn during a live user
     turn, and a user send to the superseded id during the gate's turn (it reaches `spawnTracked`
     through `messageSession`'s unchanged code and gets today's error code, which the UI already
     handles).
   - **Branch** (`gate.ts` `routeFlags`, marker set): clear `attempt.refineSessionId` first, so no
     close of the superseded session can match `onClosed` while the reseed is in flight. Then spawn
     through a new sessions.ts export (`spawnChatTurn`: `runTurn` exposed for reseed-on-stale
     kinds, returning `{ sessionId, done }`) with `gateFlagsPrompt(flags, attempt.overrides)`. On
     `SESSION_BUSY`: park — `pendingFlags = true`, marker kept, nothing spawned. On any other
     failure: today's concede-and-review fallback, marker kept, and `refineSessionId` restored to
     the story's current session so later user turns keep today's turn-end semantics. On success:
     clear the marker.
   - **Settle**: a continuation on `done` — never an `await`, which would hold the dispatcher slot
     through a refine turn — is the **sole owner** of the reseeded turn's end: if the attempt is
     still current and the phase is still `refine`, it concedes open flags, flips to `review`,
     broadcasts once, and runs `evaluate`; only *after* that does it assign
     `attempt.refineSessionId = sessionId`, so `onClosed` structurally cannot settle a reseeded
     turn (its key is unset until settle has run) and there is no dual path to distinguish. A phase
     that left `refine` mid-turn implies zero open flags (`:355`), so skipping the concession is
     vacuous, never a miss. Later user turns in the reseeded chat close through `onClosed` exactly
     as today.
   - **Park retry**: `onClosed`'s `pendingFlags` branch drops its session-id match and retries
     parked flags on **any** close — the guard's release precedes the listeners, so the retry can
     spawn immediately, and it re-parks on `SESSION_BUSY` if a different turn is still live.
     Unrelated closes cost one idempotent `routeFlags` call.
   Without the marker the path is byte-for-byte today's, `SESSION_BUSY` parking included.
3. **The seed is the story file, through the machinery that exists.** `spawnChatTurn` is `runTurn`,
   so the spawn seeds `refineSeedPrompt` from a fresh read (`seedFor`, `sessions.ts:443-452`; brief
   body, open questions, recorded rounds all in `raw`) and `persistAttach` (`:583-601`) writes the
   new id to `sessions.refine`; within-attempt rounds resume it through the unchanged path. The
   override register rides the first user message: `gateFlagsPrompt` gains an overrides parameter,
   one `title: reason` line each, mirroring `adversaryPrompt`; the resumed-round call passes none,
   so resumed rounds' messages stay byte-identical. Known limit: after a restart the register is
   empty (reasons are pass-only on disk, 005-01's deliberate scope); the reseed seeds dismissed
   titles via the recorded rounds only.
4. **The harness gains a hold-open step, and five episodes drive every branch.** The stub's script
   schema gains a `wait` step naming a sentinel path: the stub polls for the file and proceeds when
   it appears, with a bounded timeout exiting at a distinct nonzero code so a stuck episode fails
   loud (`harness/stub-claude/script.ts`, `stub.ts`) — what makes a live refine turn at routing
   time drivable at all. Episode observables are exactly four: the spawn log's parsed argv, the
   story file, the gate channel, and the session channel's `closed` frames (the only place the
   stub's minted id appears). All fixtures below carry two recorded rounds where the marker must
   fire.
   - `gate-reseed-retry` (**halts**, run by name): dismissal-plus-fix round, fix round, exhausted,
     retry; the flagged retry round spawns fresh — no `parsed.resume`, `parsed.systemPrompt`
     carrying the round-2 fix text, `parsed.prompt` carrying the flag plus the dismissed override
     line — and settles (concession → `review`); `sessions.refine` equals the id from the fresh
     turn's `closed` frame and differs from the pre-retry id. At the halt the operator reloads the
     drawer with devtools open: the pane's `session.transcript` request names the reseeded id, the
     human-visible face of the rebind and the lost scroll-back — falsifiable, since a broken reseed
     requests the old id.
   - `gate-reseed-park`: a `wait`-scripted user turn is live when flags route — the gate parks
     (no spawn, no log entry, phase holds `refine`); the sentinel releases the turn, whose close
     triggers the retry, and the fresh spawn's `start` follows the old turn's `exit` in the log.
     The fresh turn is itself `wait`-scripted, and while it is live a `session/message` to the
     superseded id returns `SESSION_BUSY` — both directions of the guard, then a normal settle.
   - `gate-reseed-restart`: exhausted, `restart()`, re-request: the flagged round reseeds off the
     recorded rounds with no attempt in memory.
   - `gate-reseed-lazy`: a retry whose adversary raises nothing passes into Ready with no refine
     spawn: the reseed is bought by the first flagged round, never eagerly.
   - `gate-reseed-spawn-failure`: `refine-1` is the chat, `refine-3.json` is pre-written,
     `refine-2.json` is withheld — the claim scan fails at the first missing ordinal
     (`script.ts:43-48`), so the marked round's spawn dies before init (`claims: false`,
     `NO_SCRIPT_EXIT`) and the fallback is observed. The episode then writes `refine-2.json`
     itself (a fix resolving the conceded flag), messages the old chat — which claims `refine-2` —
     and accepts the fix, buying round 2 under the cap; round 2's spawn claims the pre-written
     `refine-3` with no `parsed.resume`: the kept marker, observed. Declarations, in order:
     `refine-1` 0 · `adversary-1` 0 · refine ordinal 2 `claims: false` `NO_SCRIPT_EXIT` ·
     `refine-2` 0 · `adversary-2` 0 · `refine-3` 0.
5. **Three docs stop being true and are corrected**: define-refine.md §Ready gate's routing
   sentence (`:129-130`) and wait paragraph (`:149-151`) gain the retry reseed;
   session-kinds.md §Context policies' reseed-on-stale bullet (`:155-160`) gains the deliberate
   gate-retry reseed; claude-integration.md §Verifying without burning the pool's "pre-writes every
   script" sentence (`:122`) gains episode-authored mid-run scripts and the `wait` step.

## Blast radius

- `src/server/services/gate.ts` — `Attempt` gains the reseed marker; `requestReady` sets it at its
  two sites (the fresh-mint site bounded to ≥ 2 recorded rounds); `routeFlags` gains the marker
  branch (clear `refineSessionId`, spawn via `spawnChatTurn`, `SESSION_BUSY` → park, failure →
  fallback with `refineSessionId` restored, settle continuation owning the turn end); `onClosed`'s
  `pendingFlags` branch becomes id-independent. `writePass`, `evaluate`'s cap, `persistGate`, the
  tool entries, and every abort path untouched.
- `src/server/services/sessions.ts` — no longer untouched, said plainly: `spawnTracked` gains the
  synchronous one-refine-turn-per-story guard (registered before any await, released in the done
  continuation before the closed listeners), and `spawnChatTurn` is exported (`runTurn` for
  reseed-on-stale kinds, returning `{ sessionId, done }`). `messageSession`, `spawnSession`,
  `seedFor`, `persistAttach` unchanged in code; refine messages to a busy story now surface
  `SESSION_BUSY` from the guard instead of spawning a second turn.
- `src/sessions/prompts.ts` — `gateFlagsPrompt` takes the override register; empty register renders
  today's exact message. `refineSeedPrompt`, `adversaryPrompt`, `reseedPrompt` untouched.
- `harness/stub-claude/script.ts`, `stub.ts` — the `wait` step: sentinel-file poll, bounded
  timeout, distinct nonzero exit. Existing steps and claiming untouched.
- `harness/episode/episodes.ts` — five new episodes (`gate-reseed-retry` halting, the other four
  unattended); two of them author files mid-run (a sentinel, a script) into the scratch. Existing
  episodes: `gate-history-restart` is **not** shifted — one recorded round is under the bounded
  trigger, so its post-restart `refine-3` keeps resuming.
  `gate-history-block-style` (default story fixtured with two rounds,
  `:540`) is shifted: its marked round's `refine-2` becomes a fresh spawn that writes
  `sessions.refine`; its frontmatter assertions test only the `gate` block's lines (`:568-595`)
  and its `waitForSettledRound(..., 3)` settles through the continuation, so it passes.
  `gate-history-cleared` (`SECOND_ID` fixtured with two rounds, `:478`) mints a marked attempt
  whose flagless round passes without routing flags: marker set, never exercised. Declarations
  everywhere are indifferent to resume-ness (`verifySpawnLog`, `driver.ts:252-283`).
- `harness/episode/run.ts` — untouched: `all` picks up the four unattended episodes by the existing
  filter; the halting four (three existing plus `gate-reseed-retry`) stay by-name.
- `.helm/knowledge/product/features/define-refine.md` §Ready gate — `:129-130`, `:149-151`.
- `.helm/knowledge/architecture/session-kinds.md` §Context policies — `:155-160`.
- `.helm/knowledge/architecture/claude-integration.md` §Verifying without burning the pool — the
  script pre-write sentence (`:122`).
- Behavioral reach: on every reseed, `sessions.refine` is overwritten and the drawer's pane
  (`card-drawer.tsx:117-120`) follows, scroll-back gone — carried by a `(live)` criterion. A
  refine send into a story whose other refine turn is live gets `SESSION_BUSY` instead of a second
  concurrent turn — new user-facing refusal, in the code the UI already handles for a busy id. A
  mid-turn chat delays the reseed by one turn (the park). No RPC contract change, no WS channel
  shape change, no schema change, no app code change.

## Acceptance criteria

- [ ] `Attempt` in `src/server/services/gate.ts` carries the reseed marker, set in exactly two
      places: the exhausted-retry branch (`:232-235`), and the fresh-attempt mint (`:238-248`) only
      when the just-read story's `gate.rounds` holds **two or more** rounds — the exhaustion bar of
      `evaluate:376-380` — so a story with one recorded round or none sets no marker and its next
      round resumes today's session. (file)
- [ ] `spawnTracked` in `src/server/services/sessions.ts` refuses a refine spawn for a story that
      already has a refine turn in flight with `SESSION_BUSY`, via a story-keyed register checked
      and set with no await between (the function is synchronous through the process spawn) and
      released in the done continuation **before** the closed listeners run; every refine spawn —
      `spawnSession`, `messageSession` resumes to any id, the gate's reseed — passes through it. (file)
- [ ] With the marker set, `routeFlags` reads `sessions.refine` never to resume: it clears
      `attempt.refineSessionId` at branch entry, spawns through the new `spawnChatTurn` export
      (`runTurn` exposed with `{ sessionId, done }`) carrying
      `gateFlagsPrompt(flags, attempt.overrides)`; on `SESSION_BUSY` it parks
      (`pendingFlags = true`, marker kept, nothing spawned); on any other failure it runs the
      concede-and-review fallback with the marker kept and `refineSessionId` restored to the
      story's current session; on success it clears the marker. Without the marker the resume path
      (`:313-336`) is unchanged. (file)
- [ ] The reseeded turn's end is owned by a single continuation on `done` (never an `await` holding
      the dispatcher slot): if the attempt is current and the phase still `refine`, it concedes,
      flips to `review`, broadcasts once, and runs `evaluate`; `attempt.refineSessionId` is
      assigned only **after** that block, so `onClosed` structurally cannot settle a reseeded turn
      and no dual settle path exists. The skip when the phase left `refine` is vacuous by
      `evaluate`'s open-flag return at `:355`. (file)
- [ ] `onClosed`'s `pendingFlags` branch retries parked flags on any session close, id-independent,
      and `routeFlags` re-parks on `SESSION_BUSY`, so parked flags never idle whichever turn was
      live when they parked. (file)
- [ ] `gateFlagsPrompt` in `src/sessions/prompts.ts` takes the override register and appends one
      `title: reason` line each only when non-empty; the resumed-round call site passes none, so a
      resumed round's message is byte-identical to today's. (file)
- [ ] The stub's script schema in `harness/stub-claude/script.ts` gains a `wait` step naming a
      sentinel path; `stub.ts` polls for it and proceeds when it appears, exiting at a distinct
      nonzero code on a bounded timeout. Existing steps unchanged. (file)
- [ ] Episode `gate-reseed-retry` (run by name; it halts): after a two-round attempt with one
      dismissed and one fixed flag plus a fixed second round exhausts and the user re-requests,
      `spawns.log` shows the pre-retry refine turns resuming (`parsed.resume` set) and the
      post-retry refine spawn with no `parsed.resume`, a `parsed.systemPrompt` containing the
      round-2 fix text, and a `parsed.prompt` carrying the retry flag plus the dismissed flag's
      title and reason; the story file's `sessions.refine` equals the fresh turn's id from the
      session channel's `closed` frame and differs from the pre-retry id; the turn settles
      (contested, phase `review`) — reachable only through the settle continuation, since
      `onClosed` cannot match an unset id. At the halt, reloading the drawer with devtools open
      shows the pane's `session.transcript` request naming the reseeded id, not the pre-retry one —
      the visible rebind and lost scroll-back. (live)
- [ ] Episode `gate-reseed-park`: with a `wait`-scripted user turn live when flags route, the gate
      parks — no spawn, no `start` entry, phase holds `refine`; releasing the sentinel closes the
      turn and the retry's fresh `start` follows that turn's `exit` in the log; while the
      `wait`-scripted fresh turn is live, a `session/message` to the superseded id returns
      `SESSION_BUSY`; the turn then settles normally. (live)
- [ ] Episode `gate-reseed-restart`: after exhaustion (two recorded rounds), `restart()`, and a
      re-request, the flagged round's refine spawn carries no `parsed.resume` — the recorded
      rounds, not the in-memory attempt, trigger the reseed. (live)
- [ ] Episode `gate-reseed-lazy`: a retry whose adversary raises no flags passes into Ready with no
      refine spawn at all — refine spawns stay at three and `sessions.refine` is unchanged. (live)
- [ ] Episode `gate-reseed-spawn-failure`: on a story fixtured with two recorded rounds, with
      `refine-3.json` pre-written and `refine-2.json` withheld, the marked round's spawn dies
      before init (`claims: false`, `NO_SCRIPT_EXIT` — the scan fails at the first missing
      ordinal) and the fallback is observed: flag contested with no argument, phase `review`,
      `sessions.refine` unchanged. The episode writes `refine-2.json` into
      `ctx.scratch.scriptsDir`, messages the old chat (which claims it), accepts its fix, and
      round 2's spawn claims `refine-3` with no `parsed.resume` — the marker survived the failure.
      Declared spawns exactly: `refine-1`, `adversary-1`, refine `claims: false`, `refine-2`,
      `adversary-2`, `refine-3`. (live)
- [ ] `node harness/episode/run.ts all` passes 13/13 — the nine existing unattended episodes plus
      `gate-reseed-park`, `-restart`, `-lazy`, `-spawn-failure` — with `gate-history-restart`'s
      post-restart round still **resuming** (one recorded round is under the bound) and
      `gate-history-block-style`'s marked round now a fresh spawn; the halting four (`contested`,
      `exhausted`, `gate-history-cold`, `gate-reseed-retry`) each run by name to their halts. (live)
- [ ] `pnpm check` passes. (command)
- [ ] `.helm/knowledge/product/features/define-refine.md` §Ready gate states that a re-requested
      gate that already spent its two rounds runs its fix round in a fresh refine session seeded
      from the story file (`:129-130`, `:149-151` corrected). (file)
- [ ] `.helm/knowledge/architecture/session-kinds.md` §Context policies' reseed-on-stale bullet
      names the gate-retry reseed alongside the stale-transcript one. (file)
- [ ] `.helm/knowledge/architecture/claude-integration.md`'s script sentence (`:122`) covers
      episode-authored mid-run scripts and the `wait` step. (file)

## Out of scope

- Delta rounds (005-03) and the round budget, escalation surface, and digest (005-04).
- Reseeding on a re-request with fewer than two recorded rounds: a single interrupted round keeps
  its session and its conversation.
- Persisting a dismissal's override reason so it survives a restart: 005-01 deliberately kept
  reasons pass-only, and 005-04 decides what its digest needs — a post-restart reseed carries
  dismissed titles via the recorded rounds only.
- Any change to the two-automatic-round cap, `evaluate`'s exhaustion rule, the adversary's prompt
  or its override handling, or the flag round trip.
- Reseeding within an attempt (mid-attempt rounds keep resuming), reseeding any other chat kind, or
  touching `messageSession`'s stale-transcript reseed path.
- Deleting or archiving the superseded refine transcript, and any UI affordance announcing the
  reseed beyond the pane following `sessions.refine`.

## Open questions

- [x] The durable reseed trigger is "two or more recorded rounds", the exhaustion bar: a
      post-restart or post-abort retry of a spent gate reseeds, while a single interrupted round
      keeps its session.
