---
id: 002-04
status: review
depends: [002-01]
branch: helm/002-04-queue-rate-meter
gate: { passed: 2026-07-20T13:23:00.925Z, brief: 6abe77010f9a7fac, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: 9fe5ce30-08fb-4363-b74f-1d1d55210671, brief: 6abe77010f9a7fac, started: 2026-07-20T13:26:40Z, outcome: review, grades: 10/10, tokens: 587171, minutes: 24.3 }
---
# Run queue & rate-limit meter

## Goal

Runs dispatch through the serial dispatcher 001-06 built (concurrency cap 1; chat kinds keep
bypassing it), and the board header's placeholders become the live rate-limit meter and queue
occupancy fed by the `rate_limit_event` every session emits
(`.knowledge/product/features/runs.md` §Queue & rate limits). Auto-pause on limit errors is v2
with parallel runs; v1 shows the meter and the reset clock.

## Approach

**A dispatcher with a face.** `src/server/dispatcher.ts` grows from the bare promise chain into a
labeled serial queue with the same core contract: `dispatch(task, meta)` still returns the task's
promise, `meta` is `{ kind: SessionKind; storyId?: string }`, and the cap stays a constant 1.
It adds `queueSnapshot()` (`{ cap, running, queued }`, metas in order), `onQueueChange(listener)`
(fired on every enqueue, start, settle, and cancel), a `{ front: true }` dispatch option that
enqueues ahead of waiting entries, and `cancelQueued(storyId)`, which removes that story's
*queued* (never running) entry of `kind: "run"` — kind-scoped, because a story can also hold a
queued adversary entry (a gate round waiting behind the cap) and `run.dequeue` must never eat
that one; the cancelled task never runs and its `dispatch` promise rejects with a
`QueueCancelledError` the caller swallows. The existing callers pass meta and are
otherwise untouched: the gate's rounds (`kind: "adversary"`, the story id) and research spawns
(`kind: "research"`).

**Runs hold a slot for their whole segment.** `run.start`, `run.answer`, and `run.steer` route
through the dispatcher; the queued task spans spawn to the process's close handling
(`state.closed`), so the slot frees exactly when the process dies: a needs-input flip, a pause, a
stop, a steer's kill, and a normal finish all release it, and a paused or asking story (no
process) holds no slot. The task's own promise (what `dispatch` returns and what holds the slot)
therefore settles at close, not at init — so each path surfaces the spawn separately: the task
resolves an init signal (`Promise.withResolvers`) with `{ sessionId }` when the spawn lands (or
rejects it with the spawn's error), keeps awaiting `state.closed` internally, and the dispatch
promise itself is consumed with a swallow-catch (failures already surface through the init signal
or the close path). The caller awaits the init signal, never the task. Each path keeps its shape
and gains the same split:

- Enqueue-time precheck, failing fast to the caller: the validations the path already runs
  (`validateStart`, the resume spec's `precheck`) on a fresh read, plus `RUN_ACTIVE` when the
  story already has a *queued* entry (any path, one queued task per story). The live-state
  `RUN_ACTIVE` guard is fresh-start-only: `run.start` rejects on a live state as today, while a
  continuation tolerates its own story's segment — a steer's target is by definition live, and
  an answer can meet the asking process's teardown — and consumes or waits it out exactly as
  `resumeRun` does today.
- When the entry runs next (the slot is free with nothing queued ahead, or, for a steer, the
  only holder is the segment the steer itself just killed): dispatch and await the init signal;
  the response is `{ sessionId }` as today, with the bounded teardown wait inside.
- Otherwise: enqueue and return `{ queued: true }` at once; the three responses become the union
  `{ sessionId: string } | { queued: true }`. At dequeue time the path re-runs its own validation
  (start's write-queue `validateStart`, the resume's `precheck`/`recheck` are already
  dequeue-time by construction): a story that left `ready`, lost gate freshness, or lost its
  question while waiting is skipped with a board notice and the queue advances; a dequeue-time
  spawn failure surfaces the same way. `noticeSchema` (`src/board/schema.ts`) gains the kind
  `"run-skipped"`, and the board service exports a `broadcastNotice` the runs service calls (the
  watcher's `onNotice` path reuses it).
- Continuations enqueue at the front: an answer or steer resumes an in-flight attempt, which
  precedes queued fresh starts; fresh starts keep start-request order (the manual-start FIFO;
  automatic Ready-order scheduling belongs to the deferred dependency-aware queue,
  `.knowledge/product/features/board.md` §Epics).

Ordering is enqueue-then-kill: `steerRun` front-enqueues the resume *before* killing the live
process, so when the killed task settles at `closed` and frees the slot, the resume is already
ahead of every waiting fresh start; a kill-first order would race the dispatcher's advance and
hand the freed slot to a queued fresh run. The killed task settles only after `finishRun`'s
cleanup (that is what `closed` resolves on), so the front-queued resume task starts with the old
state gone; the bounded `closesInTime` wait inside `resumeRun` stays as the `RUN_ACTIVE`
backstop. `pauseRun`/`stopRun` never queue (they only kill and write), and boot reconciliation
is untouched.

**`run.dequeue`.** A new procedure `{ id }` cancels the story's queued run entry via
`cancelQueued`; `NOT_FOUND` when the story has none. It never touches a running slot (stop and
pause own the live process) and never a queued gate entry (kind-scoped above).

**Meter: parse, accumulate, broadcast.** `src/sessions/events.ts` gains `parseRateLimitEvent`
(the tolerant-boundary pattern): the payload nests under `rate_limit_info`, and parsing returns
`{ status, resetsAt, windowType }`. The verbatim frame, measured live on CLI 2.1.215
(2026-07-20 transcripts): `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed",
"resetsAt":1784548800,"rateLimitType":"five_hour","overageStatus":"rejected",...},
"session_id":"..."}` — `resetsAt` is unix seconds. The stream-json spike README describes these
fields as top-level; that line is stale against the measured frame and this story corrects it
(`spikes/stream-json/README.md`).
`src/server/services/sessions.ts` gains `onSessionEvent(listener)` mirroring `onSessionClosed`,
invoked from `spawnTracked`'s `onEvent` — every kind flows through it, runs included. A new
`src/server/services/meter.ts` subscribes and keeps, in memory only:

- the latest rate-limit info per `windowType` (a map, so a weekly event renders if the CLI ever
  emits one; only `five_hour` is observed today);
- token samples `{ at, tokens }`, one per result event across every kind (the non-cache-read sum
  `parseResultEvent` already computes, the documented lower-bound estimate), pruned past the
  trailing 7 days.

The 5-hour figure sums samples since the window start: `resetsAt − 5h` while the reset is ahead
of now, the trailing 5 hours otherwise (a stale reset means the window rolled with no session
since). The weekly figure is the trailing-7-day sum. A restart clears the samples; the meter is
already a lower bound (other machines are invisible), so the loss only widens the underestimate
and nothing persists (`.knowledge/architecture/claude-integration.md` §Rate limits). A new
`meterChannel` (`src/shared/channels.ts`, snapshot schema in `src/shared/meter.ts`, the gate
pattern) sends `{ queue, windows, tokens: { fiveHour, week } }` on every (re)subscribe and on
every change — queue changes via `onQueueChange`, meter changes per event — debounced 100ms, the
board channel's pattern.

**Header.** A new `src/app/lib/meter-store.ts` subscribes to the channel (the gate-store
pattern). `board-header.tsx` replaces its two placeholders:

- Queue occupancy: `queue R/C` plus `+N` when entries wait, with a dropdown listing each entry
  (kind, story id) and a cancel button on queued run entries calling a new `dequeueRun`
  session-store action (the toast-on-error shape).
- Rate meter: the 5-hour token sum with the reset clock (compact `k`/`M` formatting, local time)
  and the 7-day sum; a non-`allowed` status renders the meter in destructive styling — display
  only, auto-pause and chat-send disabling stay v2.

**Docs.** `api.md`: the `run.start`/`run.answer`/`run.steer` rows gain the queued union, a
`run.dequeue` row, and the WS protocol section gains the `meter` channel.
`spikes/stream-json/README.md`: the stale top-level field description corrected to the nested
`rate_limit_info` shape. `session-kinds.md` and `claude-integration.md` already state the
dispatch policy and the event; no change.

## Blast radius

- `src/server/dispatcher.ts`: labeled queue, snapshot, change listener, front option, cancel.
- `src/server/services/runs.ts`: the three paths' enqueue/precheck split, dequeue, skip notices.
- `src/server/services/gate.ts`, `src/server/services/proposals.ts`: pass dispatch meta.
- `src/server/services/board.ts`: exported `broadcastNotice`; `src/board/schema.ts`:
  `"run-skipped"` notice kind.
- `src/sessions/events.ts`: `parseRateLimitEvent`; `src/server/services/sessions.ts`:
  `onSessionEvent`.
- `src/server/services/meter.ts` (new), `src/shared/meter.ts` (new), `src/shared/channels.ts`:
  the meter service and channel; regenerated service index.
- `src/worker/routes/run.ts`: response unions + `dequeue`; regenerated route index.
- `src/app/lib/meter-store.ts` (new), `src/app/lib/session-store.ts` (`dequeueRun`),
  `src/app/components/board-header.tsx`: the live header.
- `spikes/stream-json/README.md`: the stale `rate_limit_event` shape line.
- Untouched: `src/sessions/` runner/kinds/prompts, the MCP layer, the board watcher/store,
  worktrees, chat and activity panes, `reconcile`.

## Acceptance criteria

- [ ] With the slot free, `run.start` behaves exactly as today and returns `{ sessionId }`; with
  it held, it validates up front, returns `{ queued: true }`, the entry appears in the header
  occupancy, and the run spawns when the slot frees, fresh starts in start-request order.
- [ ] A story that left `ready` or lost gate freshness while queued is skipped at dequeue with a
  `"run-skipped"` board notice and the queue advances; a dequeue-time spawn failure surfaces the
  same way instead of wedging the queue.
- [ ] `run.answer` and `run.steer` return the same union and enqueue at the front: with a fresh
  run waiting, a steer or answer takes the slot before it — the steer's resume is enqueued
  before its kill, so the freed slot cannot fall to the waiting fresh start.
- [ ] `run.dequeue` cancels a queued run — only the `run`-kind entry, never a queued gate round
  for the same story — and rejects `NOT_FOUND` when none exists; `RUN_ACTIVE` rejects any path
  on a story with a queued entry, and rejects `run.start` (fresh starts only) on a live one.
- [ ] A run holds the dispatcher slot from spawn to process close: a needs-input flip, a pause,
  and a stop each free it (a queued entry spawns after each), and a paused or asking story holds
  no slot.
- [ ] Gate adversary rounds and research sessions ride the same queue with kind labels and count
  in the occupancy; chat kinds bypass it (a refine message sends during a live run).
- [ ] Every session's `rate_limit_event` updates the meter: the header shows the 5-hour window's
  reset clock, and a non-`allowed` status renders as limited (styling only).
- [ ] Token sums accumulate from every kind's result events: the 5-hour figure counts samples
  since `resetsAt − 5h` (trailing 5 hours when the reset is stale), the weekly figure the
  trailing 7 days, samples prune past 7 days, and state is in-memory only.
- [ ] The `meter` channel sends its snapshot on subscribe and on queue or meter change, and both
  header placeholders are gone.
- [ ] `pnpm check` passes.

## Out of scope

- Queue auto-pause on limit errors, resume at window roll, a limit-interrupted run pausing, and
  chat-send disabling during a limit → v2 (Goal).
- Card-level queued badges and Run/Queued card actions → 002-08's button retrofit.
- Parallel runs (the cap stays a constant 1) and dependency-aware Ready-order scheduling →
  roadmap Later.
- The standing-context meter (init feature) and persisting token history across restarts.

## Open questions

None open; slot lifetime (spawn to process close), front-enqueued continuations, and the
in-memory lower-bound meter are settled in Approach.
