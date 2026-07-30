---
id: 005-02
status: refining
depends: [005-01, 005-06]
sessions: {}
---
# Reseed refine on retry

## Goal

A re-requested gate after exhaustion runs its fix round in a fresh refine session seeded from the
story file, instead of resuming `sessions.refine`. The resumed transcript hurts twice: its replay
re-enters the session on every fix round, so the per-round price grows with the rounds already
spent, and it carries sunk-cost bias. The 004-02 session kept reintroducing the supersession design
its own transcript had argued for, even after edit resolutions removed it
([loop-findings](../../../research/loop-findings.md) §004 loop). What broke that loop was a fresh
read of the brief with no chat history. The seed is the durable state: the brief body, the open
questions, and the attempt's override register. Anything that survives only in chat history was
never durable, the files-as-truth rule the board already lives by
([board-storage](../../../knowledge/architecture/board-storage.md)). Within an attempt the session
still resumes. The reseed boundary is the user's retry of an attempt the gate already declared
exhausted, where two rounds have proven the current context stuck.

## Approach

Measured at `ad17280`, re-checked at `d81b45d` (board-only commits since, no code anchor moved):

- **The retry path never touches the session, and the exhausted attempt is the only exact record of
  exhaustion.** `requestReady` (`gate.ts:200-255`) handles a user retry by calling `enqueueRound` on
  the same in-memory object when its phase is `exhausted` (`:236-240`); every other entry mints a
  fresh `Attempt` with `overrides: []` (`:242-253`). Exhaustion itself is `evaluate`'s last branch
  (`:392-396`): two rounds in *this* attempt plus a brief hash that moved (`:388`), reached only
  past the early returns on open (`:371`) and contested (`:372`) flags.
- **`gate.rounds` cannot stand in for that.** `persistGate` (`:156-190`) numbers each round against
  the **durable** list, `n = rounds.length + 1` memoized per attempt in `attempt.durableRounds`
  (`:167-170`), so the record accumulates across attempts: two separately interrupted single-round
  attempts leave two recorded rounds with nothing ever exhausted. The stored shape is
  `{ n, flags: [{ title, status }] }` (`schema.ts:78-88`) and carries no attempt boundary, no phase
  and no timestamp, and both clearing writes wipe the whole list (`writePass`, `gate.ts:405-410`;
  `clearGateRounds`, `transitions.ts:62-64`). No existing durable field distinguishes "spent" from
  "interrupted twice". The trigger is therefore the live attempt's `exhausted` phase, and this story
  adds no durable field: a retry with no attempt in memory resumes, which is exactly today's
  behavior.
- **That choice also keeps the seed complete.** `attempt.overrides` holds `"title: reason"` strings
  (`gate.ts:586`) that never reach disk except on a pass (`writePass`, `:405-410`); recorded rounds
  keep dismissed titles without reasons. Triggering on the in-memory attempt means the register is
  always populated at the moment the reseed fires.
- **`routeFlags` is the one resume site** (`:313-344`): it returns when the attempt has no round
  (`:315`), reads `sessions.refine` (`:317`), concedes when the story carries none (`:318-323`),
  assigns `attempt.refineSessionId` (`:324`) and flips the phase to `refine` (`:325`) **before**
  awaiting `messageSession` (`:327-330`), so an instant close still matches `onClosed`'s key
  (`:618`) and phase check (`:619`). It parks on `SESSION_BUSY` (`:335-338`) and concedes on any
  other failure (`:339-343`).
- **That phase flip is load-bearing, so the reseed keeps it in the same position.** Every downstream
  guard fails closed on `adversary`: the settle's flip reads `attempt.phase === "refine"` (`:622`),
  `evaluate` returns unless the phase is `refine` or `review` (`:368`), and `contestGateFlag`
  refuses the session's `contest_flag` outside those two phases (`:470-475`). A reseeded turn
  spawned without the flip would answer into refusals and its round would never settle.
- **`onClosed` guards its settle five ways, and a detached continuation inherits none of them**
  (`:607-624`). In source order: the loop `for (const attempt of attempts.values())` (`:608`); the
  parked-round short-circuit `if (attempt.pendingFlags === true)`, which appends a retry link and
  `continue`s (`:611-616`), so while a round is parked a close is a retry signal and never a settle;
  the id-less return (`:617`); the id match (`:618`); and the phase check admitting only `refine` or
  `review` (`:619`). The last two but one are how `onClosed` decides *which* attempt a close belongs
  to, the continuation's own concern by construction. The loop, the parked-round branch and the
  phase check are about what the attempt is doing, and the continuation needs every one:
  `dropGateAttempt` (`:98-101`) exists so a cleared record is not restored by a later broadcast, and
  its comment (`:95-97`) says so, while `broadcast` is `persistGate` (`:79-82`) whose only in-task
  guard is `status !== "refining"` (`:161`).
- **A reseeded turn can outlive its own round, and the reachable case is a park.** Accepting a fix
  while the turn is live calls `gateBriefEdited` (`:496-513`) and so `evaluate`; with the rounds
  spent and a moved hash that sets `exhausted` (`:392-396`). The user re-requests (`:236-240`),
  `runRound` pushes round N+1 at phase `adversary` (`:280-281`), and `recordAdversaryFlag`
  (`:454-459`) fills it, an adversary spawn taking no story key (`sessions.ts:291-293`). When that
  round routes, `spawnTracked` throws `SESSION_BUSY` because the old refine turn still holds the key
  (`:293-301`), so the round parks at phase `refine` with its flag `open`. The old turn's `done`
  then fires against a round it never owned, and `concedeOpenFlags` (`gate.ts:358-364`) would
  contest the in-flight round's flags. The phase check alone does not catch this (the phase is
  `refine` again) and `evaluate`'s open-flag return (`:371`) says nothing about it: that proves only
  that *`evaluate`* cannot flip out of `refine` with a flag open. The park guard catches it, and the
  story key is why the park is the only reachable shape: while the old turn holds the key no second
  refine turn can spawn, so a later round is either parked or has not routed yet, which the phase
  check covers.
- **Round identity is the check that does not depend on that list.** `currentRound` (`:103-105`)
  reads the last pushed round, and rounds are pushed only by `runRound` (`:280`), so the round a
  turn was spawned for is a stable reference. A settle that takes its round as an argument and
  refuses when `currentRound` has moved is correct whatever a future reader forgets, and it costs
  one parameter.
- **`done` can reject, and a rejection must not strand the round.** `spawnTracked` builds `done` as
  `child.done.then(...)` whose body calls every closed listener (`sessions.ts:358-379`), and the
  codebase already treats a throwing listener as live: `runTurn` awaits `tracked.done.catch(() => {})`
  for exactly that reason (`:419-425`). Every existing `done` is awaited under a catch
  (`gate.ts:288` beneath `enqueueRound`'s `:262`; `grader.ts:276`; `proposals.ts:449`); the reseed's
  is the first detached one. A settle attached only to fulfilment would leave the round at `refine`
  with `refineSessionId` unset, so `onClosed:618` cannot match either and nothing ever settles it.
  The turn's end is its end whichever way `done` settles.
- **A fresh spawn seeded from the story file already exists, under a name that lies.**
  `runColdSession` (`sessions.ts:141-163`) is `runTurn` plus `asSpawnFailed`, and `runTurn`
  (`:401-440`) is kind-agnostic: with no `resume` it calls `seedFor` (`:494-503`), which builds
  `refineSeedPrompt` from a fresh `readStoryFile` for the `refine` kind, and it persists the new id
  to `sessions.refine` through `persistAttach` (`:434`, `:634-664`) because `refine` is
  `reseed-on-stale`. The seed rides `--system-prompt` after the registry row's prompt
  (`runner.ts:159-162`); a resume passes none, so the two spawns are distinguishable on argv alone.
- **`SESSION_BUSY` survives that path.** `asSpawnFailed` (`sessions.ts:505-508`) converts only
  `SessionSpawnError`, so the guard's `ApiError` (`:293-301`) reaches the caller unchanged and
  today's park catch still fires; a pre-init death arrives as `SPAWN_FAILED` and takes the
  concede-and-review fallback.
- **The reseed may await the spawn but never the turn.** `runRound` holds a dispatcher slot
  (`gate.ts:259-261`) for the whole call, while chat spawns take no slot at all: `spawnSession`
  (`sessions.ts:113-135`) and `messageSession` (`:165-231`) call `runTurn` with no `dispatch`.
  Awaiting the spawn matches what `messageSession` already costs the slot; awaiting `done` would
  hold it for a whole refine turn.
- **A turn that ends before its id is known cannot settle through `onClosed`.** `runTurn` returns
  only after `child.started` and `persistAttach`'s queued write, and a silent script's turn can
  close inside that window. The id-matched branch would then miss it and the round would idle at
  `refine` forever, which is why the reseeded turn's end has to ride `done`.
- **The register needs a framing sentence, not just bullets.** `gateFlagsPrompt` (`prompts.ts:148-156`)
  renders each flag as `- ${title}: ${detail}` (`:154`) under a header demanding an answer to every
  one, so an override bullet appended to that list is byte-shaped like an answerable flag.
  `adversaryPrompt` separates the two with a blank line and "The user has already accepted these
  risks; do not re-raise them:" (`:135-141`); that sentence is what makes the register a register. A
  reseeded session has no chat history to disambiguate, and answering a dismissed flag hits refusals
  in `contestGateFlag` (`gate.ts:479-481`) and `gateFixProposed` (`:528-536`) or re-edits an
  overridden risk, the loop this story exists to break. `gateFlagsPrompt` has exactly one caller
  (`gate.ts:329`).
- **The guard, the park heal and the `wait` step are inherited, not built.** `spawnTracked` acquires
  a story key for every refine spawn with a story attach (`sessions.ts:289-301`) and releases it in
  the done continuation (`:303-308`, `:359`) ahead of the closed listeners (`:367-369`), so a retry
  issued from a listener can spawn immediately. `holding()` and `releaseSentinel` exist
  (`episodes.ts:670-681`, `driver.ts:254-256`).
- **The reseed's park diverges from the one 005-06 pinned, in the assertion that matters.**
  `refine-turn-park` (`episodes.ts:827-905`) proves the resume-path heal and asserts
  `retried.parsed.resume === chat` (`:880`); a reseed's heal must show the opposite, `parsed.resume`
  unset and `sessions.refine` moved. Both are drivable with what exists: a start entry carries
  `parsed` before the claim check runs (`stub.ts:77-96`), so a spawn that dies on a withheld ordinal
  still logs its argv, which lets one episode assert the heal spawned fresh *and* observe the
  other-failure fallback (`claims: false`, `NO_SCRIPT_EXIT`, `sessions.refine` unchanged).
- **Harness observables cover every claim below.** Start entries carry `parsed.resume`,
  `parsed.systemPrompt` and `parsed.prompt` (`stub.ts:77-91`, `argv.ts:15-35`); the stub keeps a
  resumed id and mints a uuid only on a fresh spawn (`stub.ts:98`), so `sessions.refine` changing is
  itself the reseed's signature; `closed` frames carry the minted id (`observer.ts:111-113`);
  `waitForRecord` asserts the durable record (`driver.ts:87-106`); `verifySpawnLog` demands the
  exact ordered start list (`driver.ts:267-298`). `EPISODES` holds 16 with 4 halting
  (`episodes.ts:985-1002`), so `run.ts all` runs 12 (`run.ts:17-20`).
- **No committed episode retries an exhausted attempt.** `exhausted` halts at exhaustion
  (`episodes.ts:267-270`) and `gate-history-restart` re-requests only after a restart (`:459-465`),
  which mints a fresh attempt. The marker never fires in today's suite, so no existing episode
  shifts.
- **The suite these criteria grade against is noisy, and this story states its grading rule rather
  than repairing or dodging it.** 005-07 measured `one-flag` failing 3 of 6 isolated runs and
  `exhausted` 2 of 4, at `5f1461c` and at `7501327` alike, with the evidence pointing at
  `waitForFlag` (`driver.ts:154-169`) and `waitForPhase` (`episodes.ts:92-99`) sampling the
  observer's last-write-wins snapshot on a 50 ms poll (`observer.ts:81-114`, `:133-143`).
  `exhausted` is shielded by `halts: true` (`episodes.ts:225`) and `run.ts all` filters halting
  episodes out (`run.ts:19`), so two of this story's episodes replay the exhaustion beats inside the
  unattended suite for the first time. Three ways out, and the judgement is stated here rather than
  left to the run: a dependency on 005-07 blocks a refined story behind a backlog one
  (`07-deterministic-episodes.md:1-6`); routing the new episodes onto the observer's accumulated
  probes (`observer.ts:51-56`) is the masking 005-07 explicitly warns against, and the ordering bug
  it could hide is one of this story's own new branches; so the suite criterion carries the
  isolation rule instead, the one 005-06's review already used (`06-one-refine-turn.md:326-328` and
  its run notes), with the counts recorded.
- **The pane's rebind is a consequence of the server's write, not of anything this story builds in
  the UI.** `ChatTab` derives its session from `props.story.frontmatter.sessions.refine` first
  (`card-drawer.tsx:117-120`), and the pane hydrates whatever id it is handed (`chat-pane.tsx:142`
  calling `hydrateChat`, `session-store.ts:653-665` calling `api.session.transcript` at `:657`;
  route `src/worker/routes/session.ts:43-45`). Nothing in `src/app/` decides which session a story
  shows, so the gate's write to `sessions.refine` is the whole mechanism and this story's diff into
  app code is zero. That is why no `(live)` criterion covers the pane: there is no new UI behavior
  to drive, only existing UI following a value it already followed. A human still drives it once by
  hand after the run, recorded as a `verify:` note rather than an episode.

Changes:

1. **The attempt knows its refine context is stale.** `Attempt` (`gate.ts:38-59`) gains a reseed
   marker set in exactly one place: the exhausted-retry branch (`:236-240`). The fresh-attempt mint
   never sets it, so a story's recorded rounds trigger nothing and a first-ever gate, a post-restart
   re-request and a post-abort re-request all resume today's session with the user's conversation
   intact. No durable field is added, and the `gate` block's format is untouched.
2. **The marked branch spawns fresh.** In `routeFlags`, the round check, the story read and the
   no-session concession (`:314-323`) stay shared. With the marker set the branch clears
   `attempt.refineSessionId`, so no close can match the id-settle while the reseed is in flight,
   then calls `setPhase(attempt, "refine")` exactly where `:325` does it today, then spawns through
   `runFreshTurn` with `gateFlagsPrompt(round.flags, attempt.overrides)`. On success it clears
   `pendingFlags` and the marker. `SESSION_BUSY` reaches today's catch and parks, marker kept,
   nothing spawned; the inherited retry chain re-enters and spawns fresh on the next close. Any
   other failure runs today's concede-and-review fallback with the marker kept and `refineSessionId`
   restored to the id read from the story, so later user turns keep today's turn-end semantics.
   Without the marker the path is byte-for-byte today's.
3. **One settle, written against `onClosed` and given the round it settles.**
   `settleRefineTurn(attempt, round)` takes the body at `:620-624` and reproduces every guard
   `onClosed` applies to it that is about the attempt rather than about identifying the close: the
   map membership of `:608`, the parked-round short-circuit of `:611-616` (a parked round's close
   belongs to its retry chain, never to a settle), and the phase check of `:619`. It adds one guard
   neither caller has today, `currentRound(attempt) === round`, so the function settles the round it
   was handed or nothing at all. `onClosed` keeps its id-less return and id match (`:617-618`) and
   calls `settleRefineTurn(attempt, currentRound(attempt))`, where the new check is true by
   construction and the parked branch already returned, so its behavior is unchanged.
4. **The reseeded turn's end rides a settled continuation, never an await.** The branch captures
   `currentRound(attempt)` before the spawn and attaches a continuation to the spawn's `done` that
   runs on **either** settlement: a rejection is logged through `logError` and the settle still runs
   with that captured round, then `attempt.refineSessionId` is assigned, and the chain ends in
   `.catch(logError)` like every other fire-and-forget in the file. So the round settles exactly
   once whether the listener chain threw or not, `onClosed` cannot double-settle it (the id is unset
   until the settle has run), a turn outliving its round settles nothing, and no rejection reaches
   the process unhandled.
5. **`runColdSession` is renamed `runFreshTurn`** (`sessions.ts:141-163`), its comment widened from
   "the always-cold kinds" to "spawns that never resume: the cold kinds, and the gate's reseed of a
   spent refine chat". Body unchanged; the three existing call sites (`grader.ts:27`, `:276`;
   `proposals.ts:68`, `:449`; `gate.ts:33`, `:282`) follow the name.
6. **The register rides the first message, framed.** `gateFlagsPrompt` takes an override register
   and, when it is non-empty, appends a blank line, the sentence `adversaryPrompt` uses, and one
   `- title: reason` bullet each. The resumed round passes an empty register, so its message stays
   byte-identical.
7. **Three unattended episodes, a stated grading rule, and two doc corrections.** `gate-reseed-retry`
   proves the success path: the fresh spawn's argv, the rebound `sessions.refine`, and the durable
   record. `gate-reseed-not-on-record` proves the trigger's negative case. `gate-reseed-park` proves
   the park and the spawn-failure fallback. No halting episode is added, and the suite criterion
   says how a green is told from the suite's inherited noise. define-refine.md §Ready gate's routing
   sentence (`:129-130`) and its wait paragraph (`:149-152`) gain the retry reseed and its restart
   limit; session-kinds.md §Context policies' reseed-on-stale bullet (`:155-160`) gains the gate's
   deliberate reseed alongside the stale-transcript one.

## Blast radius

- `src/server/services/gate.ts`: `Attempt` gains the reseed marker; `requestReady` sets it at the
  exhausted-retry branch only; `routeFlags` gains the marked branch (clear id, keep the `:325` phase
  flip, capture the round, spawn fresh, park or fall back) and passes the register to
  `gateFlagsPrompt`; `settleRefineTurn(attempt, round)` is factored out of `onClosed` carrying the
  membership, parked-round, phase and round-identity guards, called from `onClosed` behind its
  unchanged id tests and from the reseed's settled continuation. `persistGate`, `evaluate`,
  `writePass`, `retryFlags`, `dropGateAttempt`, `concedeOpenFlags`, `currentRound`, the tool entries
  and every abort path untouched.
- `src/server/services/sessions.ts`: `runColdSession` renamed `runFreshTurn` with a widened comment,
  body unchanged. `spawnTracked`, `runTurn`, `messageSession`, `spawnSession`, `seedFor`,
  `persistAttach` untouched, `done`'s construction included.
- `src/server/grader.ts`, `src/server/services/proposals.ts`: the rename's call sites, nothing else.
- `src/sessions/prompts.ts`: `gateFlagsPrompt` takes the register and its framing sentence; an empty
  register renders today's exact message. Every other prompt untouched.
- `src/app/`: **zero diff, stated plainly because the reach looks larger than it is.** The drawer's
  pane already binds to `sessions.refine` (`card-drawer.tsx:117-120`) and already hydrates whatever
  id it is given (`chat-pane.tsx:142`, `session-store.ts:653-665`), so a reseed changes what the
  pane shows without changing a line that shows it. No component, store, route or RPC input changes,
  which is why the pane carries a `(file)` criterion and no `(live)` one.
- `src/board/schema.ts`, `src/board/markdown.ts`, `src/board/transitions.ts`: untouched. The trigger
  adds no durable field, so the `gate` block's schema, its serialization and its clearing rules all
  stand.
- `harness/episode/episodes.ts`: three episodes plus their flag and fix constants, built from the
  file's existing `holding()`, `releaseSentinel`, `acceptFix` and `NO_SCRIPT_EXIT`. `EPISODES` grows
  16 to 19, halting stays 4. No existing episode changes, because none retries an exhausted attempt.
  `run.ts`, `driver.ts`, `observer.ts`, `scratch.ts` and the stub untouched, the flaky probes
  included: this story neither repairs nor routes around them.
- `.helm/knowledge/product/features/define-refine.md` §Ready gate (`:129-130`, `:149-152`),
  `.helm/knowledge/architecture/session-kinds.md` §Context policies (`:155-160`).
- Behavioral reach: on a reseed, `sessions.refine` is overwritten and the drawer's pane follows it,
  so the user's scroll-back is gone and the superseded transcript is reachable only on disk. The
  reseeded round costs one extra queued write inside the dispatcher slot (`persistAttach`) that a
  resume skips. A retry while a user turn holds the story parks for one turn instead of failing.
  `onClosed`'s settle gains two checks that are already true on its path (the round identity, the
  parked branch it returned from) and behaves identically. No durable format change, no RPC contract
  change, no WS shape change.

## Acceptance criteria

- [ ] `Attempt` in `src/server/services/gate.ts` carries the reseed marker, set in exactly one
      place: the exhausted-retry branch of `requestReady` (`:236-240`). The fresh-attempt mint
      (`:242-253`) never sets it, so no count of `gate.rounds` can trigger a reseed and a re-request
      with no attempt in memory resumes today's session. (file)
- [ ] With the marker set, `routeFlags` never resumes: it clears `attempt.refineSessionId`, calls
      `setPhase(attempt, "refine")` where `:325` does today and before the spawn, spawns through
      `runFreshTurn` carrying `gateFlagsPrompt(round.flags, attempt.overrides)`, and clears
      `pendingFlags` and the marker on success. The phase flip's position is load-bearing: on
      `adversary`, `contestGateFlag` refuses (`:470-475`), `evaluate` returns (`:368`) and the
      settle's flip is a no-op (`:622`). `SESSION_BUSY` parks through today's catch with the marker
      kept and nothing spawned; any other failure runs today's concede-and-review fallback with the
      marker kept and `refineSessionId` restored to the id read from the story at `:317`. Without
      the marker the resume path (`:316-343`) is unchanged. (file)
- [ ] `settleRefineTurn(attempt, round)` holds the body at `:620-624` behind every guard `onClosed`
      applies to it that concerns the attempt rather than which close arrived, read off the source
      in order: map membership (`:608`), so a close after `dropGateAttempt` (`:98-101`) never
      reaches `broadcast` and cannot restore rounds `clearGateRounds` cleared; the parked-round
      short-circuit (`:611-616`), so a parked round's close feeds only its retry chain, the case a
      turn that outlived its round actually hits, since the story key (`sessions.ts:291-301`) means
      a later round can only park while the old turn is live; and the phase check admitting `refine`
      or `review` (`:619`), which covers the same round before it routed. It adds
      `currentRound(attempt) === round` (`:103-105`), so the function settles the round it was
      handed or nothing, independent of that list. Past all four it concedes, flips `refine` to
      `review`, broadcasts once, and runs `evaluate`. `onClosed` keeps its id-less return and id
      match (`:617-618`) and calls `settleRefineTurn(attempt, currentRound(attempt))`, so its
      behavior is unchanged. (file)
- [ ] The reseeded turn's end rides a detached continuation on the spawn's `done`, never an `await`
      holding `runRound`'s dispatcher slot (`:259-261`). The branch captures `currentRound(attempt)`
      before the spawn and passes it to the settle, and the continuation runs on **either**
      settlement of `done`: a rejection is logged through `logError` and the settle still runs,
      because `done` calls every closed listener in its body (`sessions.ts:358-379`) and a throwing
      listener is a live case the codebase already handles (`runTurn:419-425`), while a settle
      attached to fulfilment alone would leave the round at `refine` with `refineSessionId` unset
      and `onClosed:618` unable to match. `attempt.refineSessionId = sessionId` is assigned only
      after the settle attempt, so `onClosed` cannot double-settle a reseeded turn, and the chain
      ends in `.catch(logError)` like every other fire-and-forget in the file (`:189`, `:262`,
      `:512`, `:556`, `:588`, `:604`, `:614`), so no rejection reaches the process unhandled. (file)
- [ ] `runColdSession` in `src/server/services/sessions.ts` is renamed `runFreshTurn` with its
      comment widened to cover the gate's reseed, its body unchanged, and every existing call site
      follows (`grader.ts:276`, `proposals.ts:449`, `gate.ts:282`). (file)
- [ ] `gateFlagsPrompt` in `src/sessions/prompts.ts` takes the override register and, when it is
      non-empty, appends a blank line, the sentence "The user has already accepted these risks; do
      not re-raise them:" and one `- title: reason` bullet each, byte-matching `adversaryPrompt`'s
      framing (`prompts.ts:135-141`) so no override bullet sits in the flag list unframed. The
      resumed-round call site passes an empty register, so a resumed round's message is
      byte-identical to today's. (file)
- [ ] The drawer's rebind needs no app change, proved by reading the two files that carry it:
      `ChatTab`'s session is `props.story.frontmatter.sessions.refine` first
      (`card-drawer.tsx:117-120`), and the pane hydrates whatever id it is handed
      (`chat-pane.tsx:142` calling `hydrateChat`, which calls `api.session.transcript`,
      `session-store.ts:653-665`; route `src/worker/routes/session.ts:43-45`), with `git diff`
      showing no change under `src/app/` or `src/worker/`. What the reading proves: no app code
      chooses the session, so the gate's write to `sessions.refine` is the entire rebind mechanism.
      What it does not prove: that a human reloading the drawer after a reseed sees the new id
      requested and an empty pane. No episode drives that, and the run's closing notes carry it as a
      `verify:` item. (file)
- [ ] Episode `gate-reseed-retry`: round 1 flags and is fixed; round 2 raises two flags, one fixed
      and one conceded then dismissed with a reason, so the attempt reaches `exhausted` with two
      recorded rounds and one override. On the re-request, round 3's flag routes to a **fresh**
      spawn: `spawns.log` shows `refine-4` with `parsed.resume` unset, a `parsed.systemPrompt`
      containing the fixture card's title and the text round 1's fix wrote into the brief (the seed
      is the current story file), and a `parsed.prompt` carrying round 3's flag title plus the
      framing sentence and the dismissed flag's title and reason, while `refine-2` and `refine-3`
      each carry `parsed.resume` equal to the original chat id. The story's `sessions.refine` changes
      to an id that differs from the chat id and appears on a session-channel `closed` frame, and the
      round settles: phase `review` and `gate.rounds` on disk holding round 3 with its flag
      `contested`. Declared spawns exactly: `refine-1` 0, `adversary-1` 0, `refine-2` 0,
      `adversary-2` 0, `refine-3` 0, `adversary-3` 0, `refine-4` 0; rounds 3. (live)
- [ ] Episode `gate-reseed-not-on-record`: on a story fixtured with two recorded rounds and no
      attempt in memory, the first flagged round's refine spawn **resumes** (`parsed.resume` equal to
      the chat id, no card text in `parsed.systemPrompt`) and `sessions.refine` is unchanged, so a
      durable round count never triggers a reseed. The round settles and the record reaches three
      rounds. Declared spawns exactly: `refine-1` 0, `adversary-1` 0, `refine-2` 0; rounds 1. (live)
- [ ] Episode `gate-reseed-park`: two fixed rounds exhaust the attempt, then on the re-request
      `adversary-3` raises its flag and holds on a `wait` step while a `session/message` puts a
      `holding()`-scripted user turn live. Releasing the adversary sentinel routes the flags into a
      park: no new `start` entry, the flag stays `open`, the phase holds `refine`. Releasing the
      refine sentinel closes that turn, and the chained retry's spawn is **fresh, not a resume**: its
      `start` entry carries `parsed.resume` unset, and because its ordinal's script is withheld it
      dies pre-init (`claims: false`, `NO_SCRIPT_EXIT`), so the other-failure fallback is observed in
      the same run: the flag renders `contested` with no argument, the phase reaches `review`, and
      `sessions.refine` still holds the pre-retry chat id. Declared spawns exactly: `refine-1` 0,
      `adversary-1` 0, `refine-2` 0, `adversary-2` 0, `refine-3` 0, `adversary-3` 0, `refine-4` 0,
      refine ordinal 5 `claims: false` `NO_SCRIPT_EXIT`; rounds 3. (live)
- [ ] `node harness/episode/run.ts all` reports 15/15: the twelve existing unattended episodes plus
      `gate-reseed-retry`, `gate-reseed-not-on-record` and `gate-reseed-park`, with every existing
      episode's declarations unchanged and the halting four (`contested`, `exhausted`,
      `gate-history-cold`, `refine-turn-live`) still by-name. **The grading rule, because the suite
      is knowingly flaky (005-07):** a suite run short of 15/15 grades this criterion only when every
      failing episode then passes **3 consecutive runs by name**, and each failure's message is
      recorded in the run notes against the episode that produced it. Independently, each of the
      three new episodes passes 3 consecutive runs by name, the check 005-06's review used. A new
      episode that fails in isolation is a real failure and leaves this criterion unchecked; a
      `one-flag` wait-timeout is 005-07's, named in the notes and not repaired here. (live)
- [ ] `pnpm check` passes. (command)
- [ ] `.helm/knowledge/product/features/define-refine.md` §Ready gate states that flags resume the
      refine session within an attempt and that a re-request of an exhausted attempt runs its round
      in a fresh refine session seeded from the story file and the override register, with the
      restart limit named (`:129-130`, `:149-152`). (file)
- [ ] `.helm/knowledge/architecture/session-kinds.md` §Context policies' reseed-on-stale bullet names
      the gate's deliberate reseed of a spent refine chat alongside the stale-transcript one
      (`:155-160`). (file)

## Out of scope

- Delta rounds (005-03), and the round budget, escalation surface and digest (005-04).
- A durable exhaustion marker on the `gate` block. The trigger lives in memory, so a re-request
  after a restart or an abort resumes the existing refine session, exactly today's behavior.
  `gateSchema`, `gateBlock`'s serialization and `clearGateRounds` are untouched.
- Reseeding within an attempt, reseeding any other chat kind, and `messageSession`'s
  stale-transcript reseed path.
- Carrying the override register on resumed rounds' flag prompts. The resumed session's message
  stays byte-identical.
- Any change to the two-automatic-round cap, `evaluate`'s exhaustion rule, `persistGate`'s
  numbering, the adversary's prompt, or the flag round trip.
- Persisting a dismissal's override reason. 005-01 kept reasons pass-only, and the in-memory trigger
  means the register is always full when the reseed fires.
- Deleting or archiving the superseded refine transcript, and any UI affordance announcing the
  reseed beyond the pane following `sessions.refine`.
- A second reseed after a failed one. `gate-reseed-park` observes the fallback but stops there, so
  the marker's survival past a failure rides the marked-branch criterion's reading.
- An episode for a reseeded turn that outlives its round or for a rejected `done`. The first needs a
  mid-turn exhaustion with a second live round, the second a throwing closed listener, and the stub
  can produce neither; the settle and continuation criteria grade them by reading, and the guards
  they name make both cases no-ops rather than recoveries.
- The one-refine-turn guard, the park's retry chain and the stub's `wait` step: 005-06 landed all
  three and this story inherits them.
- Repairing the harness's sampling flakiness, or writing the new episodes around it. `waitForFlag`,
  `waitForPhase`, `waitForReady` and the observer stay as they are, 005-07 owns the diagnosis and
  the fix, and the suite criterion states how this story's green is told from that noise.

## Open questions

- [x] The reseed trigger stays in memory: the marker is set only when a retry finds an attempt in
      the `exhausted` phase, no durable field is added, and a retry after a restart or an abort
      resumes its existing refine session.
- [x] The halting `gate-reseed-live` episode is dropped. This story changes no app code, so the
      pane's rebind is graded by reading `card-drawer.tsx` and the transcript path, and a human
      drives it once by hand as a `verify:` note in the run's closing report.
