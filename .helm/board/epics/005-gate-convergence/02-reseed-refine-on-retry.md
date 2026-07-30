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

Measured at `ad17280`:

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
- **`routeFlags` is the one resume site** (`:313-344`): it reads `sessions.refine` (`:317`),
  concedes when the story carries none (`:318-323`), assigns `attempt.refineSessionId` **before**
  awaiting `messageSession` (`:324`) so an instant close still matches `onClosed`'s key (`:618`),
  parks on `SESSION_BUSY` (`:335-338`), and concedes on any other failure (`:339-343`).
- **`onClosed` already owns two behaviors this story reuses** (`:607-626`): the park's
  id-independent retry chain (`:611-616`) and the id-matched settle (`:617-624`), which concedes
  open flags, flips `refine` to `review`, broadcasts once, and runs `evaluate`. 005-06 landed both.
- **A fresh spawn seeded from the story file already exists, under a name that lies.**
  `runColdSession` (`sessions.ts:141-163`) is `runTurn` plus `asSpawnFailed`, and `runTurn`
  (`:401-440`) is kind-agnostic: with no `resume` it calls `seedFor` (`:494-503`), which builds
  `refineSeedPrompt` from a fresh `readStoryFile` for the `refine` kind, and it persists the new id
  to `sessions.refine` through `persistAttach` (`:434`, `:634-664`) because `refine` is
  `reseed-on-stale`. The seed rides `--system-prompt` after the registry row's prompt
  (`runner.ts:159-162`); a resume passes none, so the two spawns are distinguishable on argv alone.
- **`SESSION_BUSY` survives that path.** `asSpawnFailed` (`sessions.ts:505-508`) converts only
  `SessionSpawnError`, so the guard's `ApiError` (`:293-301`) reaches the caller unchanged and
  today's park catch still fires.
- **The reseed may await the spawn but never the turn.** `runRound` holds a dispatcher slot
  (`gate.ts:259-261`) for the whole call, while chat spawns take no slot at all: `spawnSession`
  (`sessions.ts:113-135`) and `messageSession` (`:165-231`) call `runTurn` with no `dispatch`.
  Awaiting the spawn matches what `messageSession` already costs the slot; awaiting `done` would
  hold it for a whole refine turn.
- **A turn that ends before its id is known cannot settle through `onClosed`.** `runTurn` returns
  only after `child.started` and `persistAttach`'s queued write, and a silent script's turn can
  close inside that window. The id-matched branch would then miss it and the round would idle at
  `refine` forever, which is why the reseeded turn's end has to ride `done`.
- **A phase can leave `refine` mid-turn only with zero open flags.** `evaluate` returns on any open
  flag (`:371`) before either flip to `review` (`:373`, `:385`), and every user RPC reachable
  mid-turn (`gateBriefEdited:512`, `gateFixRejected:556`, `resolveGateFlag:588`, `:604`) routes
  through it, so a skipped concession is vacuous.
- **`gateFlagsPrompt` (`prompts.ts:148-156`) has exactly one caller** (`gate.ts:329`), and
  `adversaryPrompt` (`prompts.ts:124-143`) already renders an override register the same way.
- **The guard, the park heal and the `wait` step are inherited, not built.** `spawnTracked` acquires
  a story key for every refine spawn with a story attach (`sessions.ts:289-301`) and releases it in
  the done continuation (`:303-308`, `:359`) ahead of the closed listeners (`:367-369`), so a retry
  issued from a listener can spawn immediately. `holding()` and `releaseSentinel` exist
  (`episodes.ts:670-681`, `driver.ts:254-256`).
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
2. **The marked branch spawns fresh and owns the turn's end.** In `routeFlags`, the story read and
   the no-session concession (`:316-323`) stay shared. With the marker set the branch clears
   `attempt.refineSessionId` first, so no close can match the id-settle while the reseed is in
   flight, then spawns through `runFreshTurn` with `gateFlagsPrompt(round.flags, attempt.overrides)`.
   On success it clears `pendingFlags` and the marker. `SESSION_BUSY` reaches today's catch and
   parks, marker kept, nothing spawned; the inherited retry chain re-enters and spawns on the next
   close. Any other failure runs today's concede-and-review fallback with the marker kept and
   `refineSessionId` restored to the id read from the story, so later user turns keep today's
   turn-end semantics. Without the marker the path is byte-for-byte today's.
3. **One settle, shared with `onClosed`.** The settle body of `onClosed` (`:620-624`) moves into
   `settleRefineTurn(attempt)`: concede, flip `refine` to `review`, broadcast once, evaluate. The
   reseed attaches it as a continuation on the spawn's `done`, never an `await`, and assigns
   `attempt.refineSessionId` after it runs, so the reseeded turn settles exactly once and later user
   turns in the fresh chat close through `onClosed` as today.
4. **`runColdSession` is renamed `runFreshTurn`** (`sessions.ts:141-163`), its comment widened from
   "the always-cold kinds" to "spawns that never resume: the cold kinds, and the gate's reseed of a
   spent refine chat". Body unchanged; the three existing call sites (`grader.ts:27`, `:276`;
   `proposals.ts:68`, `:449`; `gate.ts:33`, `:282`) follow the name.
5. **The register rides the first message.** `gateFlagsPrompt` takes an override register and appends
   one `title: reason` line each only when non-empty, mirroring `adversaryPrompt`. The resumed round
   passes an empty register, so its message stays byte-identical.
6. **Two unattended episodes and two doc corrections.** `gate-reseed-retry` proves the whole path:
   the fresh spawn's argv, the rebound `sessions.refine`, and the durable record.
   `gate-reseed-not-on-record` proves the trigger's negative case. Both run under `run.ts all`; no
   halting episode is added. define-refine.md §Ready gate's routing sentence (`:129-130`) and its
   wait paragraph (`:149-152`) gain the retry reseed and its restart limit; session-kinds.md
   §Context policies' reseed-on-stale bullet (`:155-160`) gains the gate's deliberate reseed
   alongside the stale-transcript one.

## Blast radius

- `src/server/services/gate.ts`: `Attempt` gains the reseed marker; `requestReady` sets it at the
  exhausted-retry branch only; `routeFlags` gains the marked branch and passes the register to
  `gateFlagsPrompt`; `settleRefineTurn` is factored out of `onClosed` and called from the reseed's
  `done` continuation. `persistGate`, `evaluate`, `writePass`, `retryFlags`, the tool entries and
  every abort path untouched.
- `src/server/services/sessions.ts`: `runColdSession` renamed `runFreshTurn` with a widened comment,
  body unchanged. `spawnTracked`, `runTurn`, `messageSession`, `spawnSession`, `seedFor`,
  `persistAttach` untouched.
- `src/server/grader.ts`, `src/server/services/proposals.ts`: the rename's call sites, nothing else.
- `src/sessions/prompts.ts`: `gateFlagsPrompt` takes the register; an empty one renders today's exact
  message. Every other prompt untouched.
- `src/app/`: **zero diff, stated plainly because the reach looks larger than it is.** The drawer's
  pane already binds to `sessions.refine` (`card-drawer.tsx:117-120`) and already hydrates whatever
  id it is given (`chat-pane.tsx:142`, `session-store.ts:653-665`), so a reseed changes what the
  pane shows without changing a line that shows it. No component, store, route or RPC input changes,
  which is why the pane carries a `(file)` criterion and no `(live)` one.
- `src/board/schema.ts`, `src/board/markdown.ts`, `src/board/transitions.ts`: untouched. The trigger
  adds no durable field, so the `gate` block's schema, its serialization and its clearing rules all
  stand.
- `harness/episode/episodes.ts`: two episodes, two flag constants and one fix constant. `EPISODES`
  grows 16 to 18, halting stays 4. No existing episode changes, because none retries an exhausted
  attempt. `run.ts`, `driver.ts`, `observer.ts`, `scratch.ts` and the stub untouched.
- `.helm/knowledge/product/features/define-refine.md` §Ready gate (`:129-130`, `:149-152`),
  `.helm/knowledge/architecture/session-kinds.md` §Context policies (`:155-160`).
- Behavioral reach: on a reseed, `sessions.refine` is overwritten and the drawer's pane follows it,
  so the user's scroll-back is gone and the superseded transcript is reachable only on disk. The
  reseeded round costs one extra queued write inside the dispatcher slot (`persistAttach`) that a
  resume skips. A retry while a user turn holds the story parks for one turn instead of failing. No
  durable format change, no RPC contract change, no WS shape change.

## Acceptance criteria

- [ ] `Attempt` in `src/server/services/gate.ts` carries the reseed marker, set in exactly one
      place: the exhausted-retry branch of `requestReady` (`:236-240`). The fresh-attempt mint
      (`:242-253`) never sets it, so no count of `gate.rounds` can trigger a reseed and a re-request
      with no attempt in memory resumes today's session. (file)
- [ ] With the marker set, `routeFlags` never resumes: it clears `attempt.refineSessionId` at branch
      entry, spawns through `runFreshTurn` carrying `gateFlagsPrompt(round.flags, attempt.overrides)`,
      and clears `pendingFlags` and the marker on success. `SESSION_BUSY` parks through today's catch
      with the marker kept and nothing spawned; any other failure runs today's concede-and-review
      fallback with the marker kept and `refineSessionId` restored to the id read from the story at
      `:317`. Without the marker the resume path (`:316-343`) is unchanged. (file)
- [ ] The reseeded turn's end is owned by a continuation on the spawn's `done`, never an `await`
      holding `runRound`'s dispatcher slot (`:259-261`). The continuation and `onClosed`'s id-matched
      branch call one shared `settleRefineTurn`: concede open flags, flip `refine` to `review`,
      broadcast once, run `evaluate`. `attempt.refineSessionId` is assigned only after it runs, so
      `onClosed` cannot double-settle a reseeded turn, and a phase that left `refine` mid-turn
      implies zero open flags by `evaluate`'s return at `:371`. (file)
- [ ] `runColdSession` in `src/server/services/sessions.ts` is renamed `runFreshTurn` with its
      comment widened to cover the gate's reseed, its body unchanged, and every existing call site
      follows (`grader.ts:276`, `proposals.ts:449`, `gate.ts:282`). (file)
- [ ] `gateFlagsPrompt` in `src/sessions/prompts.ts` takes the override register and appends one
      `title: reason` line each only when non-empty; the resumed-round call site passes an empty
      register, so a resumed round's message is byte-identical to today's. (file)
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
      dismissed flag's title and reason, while `refine-2` and `refine-3` each carry `parsed.resume`
      equal to the original chat id. The story's `sessions.refine` changes to an id that differs from
      the chat id and appears on a session-channel `closed` frame, and the round settles: phase
      `review` and `gate.rounds` on disk holding round 3 with its flag `contested`. Declared spawns
      exactly: `refine-1` 0, `adversary-1` 0, `refine-2` 0, `adversary-2` 0, `refine-3` 0,
      `adversary-3` 0, `refine-4` 0; rounds 3. (live)
- [ ] Episode `gate-reseed-not-on-record`: on a story fixtured with two recorded rounds and no
      attempt in memory, the first flagged round's refine spawn **resumes** (`parsed.resume` equal to
      the chat id, no card text in `parsed.systemPrompt`) and `sessions.refine` is unchanged, so a
      durable round count never triggers a reseed. The round settles and the record reaches three
      rounds. Declared spawns exactly: `refine-1` 0, `adversary-1` 0, `refine-2` 0; rounds 1. (live)
- [ ] `node harness/episode/run.ts all` passes 14/14, the twelve existing unattended episodes plus
      `gate-reseed-retry` and `gate-reseed-not-on-record`, with every existing episode's declarations
      unchanged; the halting four (`contested`, `exhausted`, `gate-history-cold`, `refine-turn-live`)
      stay by-name and this story adds no fifth. (live)
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
- A halting episode for the pane. No episode drives the drawer after a reseed, so the run's closing
  notes carry it: `verify: the drawer's rebind by hand. Retry an exhausted gate, reload the drawer
  with devtools open, and confirm the pane's session/transcript call names the reseeded id rather
  than the pre-retry one, with no scroll-back in the pane.`
- The one-refine-turn guard, the park's retry chain and the stub's `wait` step: 005-06 landed all
  three and this story inherits them.
- The roughly 50% isolation flakiness of `one-flag` and `exhausted` (005-07). Both new episodes
  reuse `acceptFix` and the exhaustion beats, so they can inherit it; neither fixing it nor
  designing around it belongs here.

## Open questions

- [x] The reseed trigger stays in memory: the marker is set only when a retry finds an attempt in
      the `exhausted` phase, no durable field is added, and a retry after a restart or an abort
      resumes its existing refine session.
- [x] The halting `gate-reseed-live` episode is dropped. This story changes no app code, so the
      pane's rebind is graded by reading `card-drawer.tsx` and the transcript path, and a human
      drives it once by hand as a `verify:` note in the run's closing report.
