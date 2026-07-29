---
id: 005-01
status: refining
depends: [005-05]
sessions: {}
---
# Gate round history

## Goal

The gate remembers what it already spent on a story, across restarts and re-requested attempts.
Attempts live in memory only (`src/server/services/gate.ts:53`, cleared on service stop at
`:557`) and the story's `gate` frontmatter block records only a pass, so a re-requested gate
starts blind and a restart erases the evidence: on 004-02 nothing counted the 21 cumulative
rounds, and the stop signal was human exhaustion at round 17
([loop-findings](../../../research/loop-findings.md) §004 loop). Every adversary round this brief
has bought — its number, its flag titles, and how each was resolved — accumulates in the story's
`gate` block as it happens, and the drawer and the card face read it from the file rather than
from memory, so a user returning to a story sees what it already cost before deciding to
re-request. Acting on that count (a budget, a re-shape recommendation, a digest) is 005-04; this
story is the record it reads.

## Approach

Measured at `cbd6844`:

- `src/server/services/gate.ts:34-53`: `attempts` is a `Map<string, Attempt>` in memory.
  `gateSchema` (`src/board/schema.ts:63-68`) is a `strictObject` of `passed` · `brief` ·
  `overrides`, and `writePass` (`:319-341`) is its only writer, so nothing about a round reaches
  disk until the gate passes. 15 stories carry a `gate` block at this commit (seven in 001, eight
  in 002); the working tree adds two in 004.
- **A round is the unit that is spent**; an attempt is a memory-lifetime artifact. A retry of an
  exhausted attempt calls `enqueueRound` on the *same* object (`requestReady:169-172`), a fresh
  `Attempt` is minted whenever the map holds none (`:166`, `:175-183`) — after every restart and
  every abort — and its `rounds` restart at 1 (`:212`). So the durable record cannot be a
  snapshot of the live attempt: it accumulates across attempts, and each attempt owns only the
  slice it added.
- `verdictValid` (`src/board/transitions.ts:56-58`) is `gate !== undefined && gate.brief ===
  briefHash(body)`. A `gate` block written without `brief` therefore reads as no verdict with no
  code change: `undefined` never equals a hash. Its callers are `canTransition` (`:78-81`),
  `requestReady` (`gate.ts:152`), `validateStart` and the run-start init write in `runs.ts`
  (`:353`, `:629`, where a history-only block would first bite a run start), and the client's
  move pre-check.
- **`enqueueWrite` is one shared FIFO chain** (`src/server/write-queue.ts:6-13`): a task awaiting
  it from *inside* a queued task can never be scheduled, hanging every board write. `writePass`'s
  body (`gate.ts:321-341`) and `requestReady`'s whole handler (`:143`) run inside one, so any
  persistence that awaits the queue from those paths deadlocks the board — not just the gate.
- **After `writePass` the attempt is never live.** It has three silent early returns (`:323`
  unreadable story, `:324` hash mismatch, `:335` failed `canTransition`), all inside the
  `enqueueWrite` closure, and control falls through to `abort(attempt)` at `:350` in every case,
  success included.
- **`broadcast()` (`:68-70`) is the one funnel every state change already passes through**, and
  no smaller one is complete: its ten call sites cover the phase flips (`setPhase:74`), the drop
  (`abort:80`, *after* the map deletion), a recorded flag (`:378`), a contest (`:409`), a fix
  landing or being rejected (`:428`, `:474`), a proposed fix (`:458`), a dismissal and an accept
  (`:506`, `:522`), and the turn-end concession at `:539`, whose phase flip is assigned
  **directly** at `:538`, deliberately bypassing `setPhase` ("one broadcast for the phase flip
  and the flag change together"). `setPhase` alone misses `:538` and every flag mutation; a list
  of round-boundary sites misses both; `abort` needs no separate hook because it broadcasts. What
  `broadcast()` lacks today is the *subject*: it takes no argument and `onClosed` (`:528-541`)
  calls it inside a loop over every attempt, so an unscoped trigger would fan out across the map.
- Phase flips are not round boundaries: `setPhase` fires for `queued` (`:190`), `adversary`
  (`:213`), `refine` (`:256`), `review` (`:252`, `:271`, `:293`, `:305`) and `exhausted`
  (`:316`), and `enqueueRound:190` flips to `queued` *before* `runRound` pushes the round at
  `:212` — so at the first `queued` flip an attempt has zero rounds and has spent nothing.
- Write volume, counted rather than estimated: within one round the record changes once per
  recorded flag (`:378`) and once per resolution (`:409`, `:428`, `:458`, `:474`, `:506`,
  `:522`), so a k-flag round is on the order of 2k record changes across minutes of wall clock.
  Each write is a frontmatter-only story rewrite that trips chokidar (`watcher.ts:295-300`, 200ms
  `awaitWriteFinish`), re-parses the story and fires a debounced full-`Board` rebroadcast
  (`board.ts:73-79`, 100ms). That is the cost this story accepts; what it must not do is multiply
  it by the number of live attempts.
- Three places move a story out of `refining`, and all three are orchestrator writes: `writePass`
  (`:336-340`), `requestReady`'s recorded-verdict fast path (`:152-158`), and the `story.move`
  route (`src/worker/routes/story.ts:60-99`), which is where a drag to `backlog` or `blocked`
  lands and which knows nothing about the gate today. The gate's own abort at `:206-210` only
  fires when a *round is starting*, so it never sees a story dragged out while the attempt sits
  in `review` or `exhausted`, and after a restart no attempt exists to abort at all. A hand-edited
  status is the one path outside all three (files are the truth, `watcher.ts`).
- **A live attempt outlives a status change today**, and `refining → backlog → refining` is legal
  (`transitions.ts:10-17`): the returning `requestReady` finds the same object (`:166-173`) with
  its old rounds. So clearing the record without also dropping the attempt is undone by that
  attempt's next broadcast. The two must move together.
- A superseded attempt can still broadcast: `routeFlags` resumes after `await readFresh` (`:248`)
  and `await messageSession` (`:258`) and calls `setPhase(attempt, "review")` (`:252`, `:271`)
  with no identity re-check, while `logAndAbort` (`:431`, `:475`, `:507`, `:523`) may have
  dropped it and a re-request minted its replacement. `abort` broadcasts *after* `attempts.delete`
  (`:79-80`), so "still in the map" is too strict a test and "in the map at all" is too loose.
- Rounds are pushed at `:212`, one line before the adversary spawns (`:213-218`), and the phase
  stays `adversary` through `runColdSession`, `await run.done` (`:220`) and the post-run re-read
  (`:222`) until `routeFlags` flips it (`:252`, `:256`, `:271`). So every interruption that
  matters — a failed spawn (`:194-200`), an unreadable story after the run (`:223-228`), a
  service stop (`:557`) — lands inside that window, and a record that waits for a verdict records
  none of them, though each burned a pass.
- The stale-brief path (`:230-236`) discards a verdict but leaves its round *and the flags the
  adversary already raised* (`recordAdversaryFlag`, `:373-377`) in place: a discarded round is
  not an empty one.
- 005-05 makes a flagged stub round drivable; without it a stub round is always flagless, always
  passes at `:238-241`, and the pass clears the record and moves the story out of `refining` —
  so the accumulating record, the exhausted phase and the file-driven surface have no zero-cost
  live path at all. This story's live criteria are written against that capability.
- `src/shared/gate.ts:2` imports `storyIdSchema` from `../board/schema.ts` and uses it at
  module-eval time (`:43`), so the flag-status enum cannot be imported the other way without a
  cycle between two files of top-level zod consts: the enum's home has to be `board/schema.ts`,
  with `shared/gate.ts` importing it.
- `serializeStory` emits `gate` whenever it is defined (`markdown.ts:134`), and `overrides`
  defaults to `[]` (`schema.ts:66`), so a cleared history-only block would linger as
  `gate: { overrides: [] }` on a story with no verdict unless the key itself is dropped.
- `story-card.tsx:35` is `gate() = isRefining() ? gateFor(id) : undefined` and the badge sits
  inside `<Show when={gate()}>` (`:50-56`), so a badge that renders without a live attempt needs
  both the condition and `gateBadgeLabel`'s signature to change.
- board-storage.md `:148-151` records the frontmatter-writing rule ("one flow-styled run per
  line, so a rewrite diffs as exactly the lines that changed"), which a conditionally
  block-styled `gate` container falsifies. `runs.ts:629` is the run-start init write, not a
  review path.
- `serializeStory` (`src/board/markdown.ts:125-138`) writes the fixed key order id · status ·
  depends · branch · preset · gate · sessions · runs, omitting `branch`/`preset` when absent;
  `stringifyFrontmatter` (`:107-123`) flow-styles the whole `gate` map (`:111-112`) and each
  `runs` item (`:115-120`) at `lineWidth: 0`, which disables wrapping — so a flow container
  holding a list renders as one unbounded line, the defect
  `004-chat-surface-redesign/02-pending-interaction.md:6` shows at seven overrides.
- `gate-panel.tsx:172-215` wraps its entire body in `<Show when={attempt()}>` — the branch a
  restarted orchestrator always hits — and renders `RoundHistory` (`:132-170`) only at
  `exhausted` (`:203`). `RoundHistory` takes `GateRound[]` (wire objects with
  `title`/`detail`/`status`, `src/shared/gate.ts:8-25`) and keys `FLAG_BADGES` off `flag.status`,
  so a persisted record must carry a status field it can key on, not a pre-formatted string.
  `card-drawer.tsx:123` already holds the whole story and passes only its id;
  `gateBadgeLabel(attempt: GateAttempt)` (`:218-224`) is called as `gateBadgeLabel(attempt())`
  inside `<Show when={gate()}>` (`story-card.tsx:50-56`), so a badge driven by anything but a
  live attempt is a signature change, not a condition tweak.
- `PHASE_LINES` (`gate-store.ts:13-21`) is shared with the drag-into-Ready toast, but
  `gatingToast` takes `Exclude<GatePhase, "exhausted">` (`board-store.ts:111`), fed by
  `requestReady`'s return type (`gate.ts:141`), so the `exhausted` line is unreachable there by
  construction: the panel is its only consumer, and changing it is panel-only.
- `gateSchema` sits inside `storyFrontmatterSchema` → `boardSchema`, the **board** channel's
  payload (api.md §WS protocol `:37`), so widening it widens what that channel carries;
  `frontmatter.gate` is optional (`schema.ts:79`), so every read of the record needs the guard.
  The `gate` channel bullet (`:71-78`) keeps its shape but carries one sentence this story makes
  false: "Attempts are in-memory only; the durable outcome is the story's `gate` frontmatter
  block."
- With 005-05 landed, the stub drives a flagged round through the MCP board tools, so a two-round
  attempt, a contested flag, an exhausted phase and an accumulating record are all live-checkable
  at zero pool cost (claude-integration.md §Verifying without burning the pool). That is what
  makes this story's live criteria real rather than "graded by reading", and it is why the
  dependency exists.

Changes:

1. **`gate` becomes the persistent gate record** (`src/board/schema.ts:63-68`): the object stays
   strict (unknown keys rejected) and gains a pairing refinement — `passed` and `brief` are both
   optional but valid only together, so a half-written pair is an invalid file rather than a
   passed-but-unverified gate; `overrides` keeps its meaning (the passing attempt's dismissals)
   and stays pass-only; one field is added, `rounds: [{ n, flags: [{ title, status }] }]`,
   defaulted to `[]`. The flag-status enum moves to `src/board/schema.ts` and `src/shared/gate.ts`
   imports it from there (the reverse edge closes a module cycle between two files of top-level
   zod consts), so the panel keys its badges off the same values as today; `title` and `status`
   stay separate fields because a title containing `": "` makes a joined string unparseable.
   Because the default makes `rounds` required on `Gate`'s output type, `writePass`'s single
   `Gate` literal (`gate.ts:325-329`, reused by the `canTransition` call at `:330-334` through
   property shorthand) carries it explicitly. `verdictValid` and every caller are untouched: a
   history-only block has no `brief` and reads as no verdict.
2. **Serialization bounds every long line under `gate`** (`src/board/markdown.ts:107-138`): the
   container is flow-styled only while **both** `rounds` and `overrides` are empty, and otherwise
   becomes a block map — `rounds` a block sequence of block maps, each round's `flags` a block
   sequence of flow maps one per line, and `overrides` a block sequence of one string per line.
   Keying on `rounds` alone would fix nothing where the defect actually lives: `writePass` drops
   `rounds` on the pass, so a block carrying `overrides` never carries history, would stay
   flow-styled, and would keep rendering seven long strings on one unbounded line
   (`004-chat-surface-redesign/02-pending-interaction.md:6`; `lineWidth: 0` disables wrapping).
   The cost is named rather than avoided: the two working-tree blocks that carry overrides
   re-serialize once as a cosmetic diff the next time anything writes them, while the 15
   committed blocks have empty `overrides` and stay byte-identical. Two omission rules make that
   true: `serializeStory` omits an empty `rounds` (a zod `.default([])` is materialized on parse
   and would otherwise be written into all 15 blocks on their next rewrite, exactly as
   `overrides: []` is today) and drops the `gate` key entirely when it holds no verdict, no
   rounds and no overrides, so a cleared record leaves no vestigial block behind.
3. **The record is append-only, and a round joins it when it is pushed.** The first time one of
   the attempt's rounds is written it takes `n = disk.rounds.length + 1` and the attempt
   remembers that number; every later write upserts that entry by `n`. There is no captured
   offset and no slice, so nothing truncates when two writes interleave, a superseded attempt can
   only rewrite its own entries, and a hand edit that adds rounds cannot be overwritten by a live
   attempt. A round enters at its push (`gate.ts:212`), not at its verdict: the adversary spawns
   one line later (`:213-218`), so a pushed round has bought a pass, and holding it back until
   the verdict would drop exactly the interrupted rounds this story exists to record — a failed
   spawn (`:194-200`), an unreadable story after the run (`:223-228`), an orchestrator killed
   mid-adversary. Its flags accumulate into the same entry as `recordAdversaryFlag` raises them
   (`:373-377`) and their statuses settle in place as the round resolves, so **the record is the
   last known state, not a closed verdict**: a round discarded by a mid-flight brief edit
   (`:230-236`) keeps the flags it raised at whatever status they had reached, and an attempt
   that dies mid-round leaves flags reading `open` or `contested` forever, which is the truth
   about what happened. Everything outside `rounds` — `passed`, `brief`, `overrides` — is
   preserved verbatim from the story just read: this write's whole job is the round list, and it
   never disturbs a recorded verdict.
4. **The write is scheduled where the live snapshot is broadcast** (`gate.ts`). The two audiences
   see the same state, so they share one trigger rather than a hand-picked list of call sites
   that the direct phase assignment at `:538` or a flag mutation would fall outside of.
   `broadcast()` takes the changed attempt (`broadcast(attempt)`), which every call site already
   has, including `abort`'s at `:80` and `onClosed`'s loop — so the persist is scoped to the one
   story that changed, never fans out across the map, and needs no second call site.
   `persistGate(attempt)` is synchronous: it **schedules** a frontmatter-only write (`void
   enqueueWrite(...)` with its own `.catch(logError)`, never awaited), so it is safe to call from
   inside a queued task and can never deadlock the board, throw into `evaluate`'s
   `.catch(logAndAbort)` callers, or abort the attempt whose state it exists to preserve. Because
   the write executes after an unknown amount of queued work, **every guard is re-checked inside
   the task, not at call time**: it re-reads the story and writes nothing when the story's status
   is not `refining` (change 5's rule, which is also what stops a write scheduled before a pass
   from re-adding history to a story now in Ready), nothing when the attempt has no rounds (the
   `queued` flip at `:190` precedes the round push at `:212`, so no empty entry ever reaches the
   file), and nothing when the computed block equals the parsed block already on disk (so a
   re-broadcast of unchanged state is free). No ownership test is needed and none is added:
   append-only upsert (change 3) makes a write from an already-deleted attempt — the abort path,
   whose broadcast fires after `attempts.delete` (`:79-80`) — and from a superseded one both
   safe, each touching only its own entries.
5. **The record lives only while the story is refining, and so does its attempt.** One rule
   replaces a list of clear sites: refining is the only status the record means anything in, so
   every orchestrator write that moves a story out of it drops `rounds` in the same write —
   `writePass`'s pass (`:336-340`), `requestReady`'s recorded-verdict fast path (`:152-158`), and
   the `story.move` route (`src/worker/routes/story.ts:60-99`), which covers the drag to
   `backlog` or `blocked` that is what a human scope cut looks like from the outside (004-02's
   ended exactly there). **Each clear drops the live attempt with it**, because an attempt that
   survives a clear restores the record on its next broadcast: `writePass` already aborts at
   `:350`; the fast path and `story.move` call a new gate entry point that aborts any attempt
   held for that story. The fast path needs it as much as the drag does — an attempt parked in
   `review`/`exhausted` whose body is edited back to the recorded `gate.brief` (an undone
   proposal, a hand-edit undo) makes `verdictValid` true at `:152` with the attempt still held.
   In `story.move` the drop happens **inside** the queued task, after validation passes and in
   the same write: dropping it before validation would let a rejected move silently kill a live
   gate attempt, the dead-interaction defect 004-01 closed. The same status rule is the scheduled
   write's guard in change 4, so the two can never disagree. Known limit, stated rather than
   papered over: a hand-edited status leaves the record and the attempt in place (files are the
   truth), and the next round on that story appends to the record.
6. **The drawer and the card face read the file** (`src/app/components/gate-panel.tsx`,
   `card-drawer.tsx:123`, `story-card.tsx`): `GatePanel` takes the `story` instead of a
   `storyId`, and its single outer guard splits in two. The phase line, `data-gate-phase` and the
   contested-flag widgets still require a live attempt from `gateFor(story.id)`. The history box
   — the cumulative round count and each round's flags with their resolutions — renders from
   `story.frontmatter.gate?.rounds` whenever the story is `refining` and the list is non-empty,
   live attempt or not, so it survives the restart that is exactly when a user returns to
   re-request. `RoundHistory` (`:132-170`) is the component that renders it: it takes the
   persisted rounds (title + status, no `detail`, no `overrides` list, since a persisted round
   carries neither) and keeps keying `FLAG_BADGES` off the status — including a flag frozen at
   `open` or `contested` by an interrupted attempt, which the badges already have labels for. The
   `exhausted`-only block at `:203-211` loses its `RoundHistory` call to that box, which now
   renders in every phase and with none, and keeps only its "Move the card to Ready to run
   another adversary pass." line under the exhausted phase. The panel renders nothing when there
   is neither a live attempt nor a record. `gateBadgeLabel` takes the persisted rounds alongside the *optional* live
   attempt (a signature change, `gate-panel.tsx:218` and `story-card.tsx:50-56`): a live attempt
   still decides the label exactly as today, and only with no attempt in memory does a non-empty
   record produce "gate spent" — so "gate blocked" stays reserved for the `exhausted` phase.
   `PHASE_LINES.exhausted` (`gate-store.ts:20`) drops its hardcoded "Two automatic rounds spent",
   false as soon as retries accumulate, for a count-free line; the exact count lives in the
   history box, which has the record.

## Blast radius

- `src/board/schema.ts` — `gateSchema` widens (paired-optional `passed`/`brief` behind a
  refinement, defaulted `rounds`) plus a new round-record schema, and the flag-status enum moves
  here from `src/shared/gate.ts`. Every other schema untouched; no migration, since the new field
  defaults. New failure mode: a hand-edited block with one half of the pair makes that story an
  invalid file.
- `src/shared/gate.ts` — `gateFlagSchema`'s status enum becomes an import from
  `../board/schema.ts` (which this file already imports from); the wire shape is unchanged, and
  the edge direction is what keeps the two files acyclic.
- `src/board/markdown.ts` — `serializeStory` drops the `gate` key when it holds no verdict, no
  rounds and no overrides; `stringifyFrontmatter` flow-styles `gate` only while both `rounds` and
  `overrides` are empty, and block-styles every container under it otherwise (flag entries stay
  flow maps, one per line). Key order, parsing, and every other serializer untouched. One-time
  on-disk effect: the two working-tree blocks carrying overrides re-serialize as block maps on
  their next write.
- `src/server/services/gate.ts` — `broadcast` takes the changed attempt and its ten call sites
  pass it; `Attempt` gains the durable round numbers it has already written; new `persistGate`
  (synchronous, fire-and-forget,
  self-catching, every guard re-checked inside the write) called from `broadcast` alone; a new
  exported entry point that drops a story's attempt, called by `story.move`; `writePass` carries
  `rounds` in its `Gate` literal and drops the record on its pass; the recorded-verdict fast path
  drops it. Round mechanics, flag routing, and the two-automatic-round cap unchanged.
- `src/worker/routes/story.ts` — the `story.move` handler drops `gate.rounds` in the same write
  and drops the gate's held attempt when the transition leaves `refining`. Validation and every
  other transition untouched.
- `src/app/components/gate-panel.tsx` — `GatePanel`'s prop becomes the story; its outer guard
  splits into the live-attempt half (phase line, `data-gate-phase`, flag widgets) and the
  file-driven history box; `RoundHistory` renders persisted rounds (title + status) and loses its
  `overrides` list; `gateBadgeLabel`'s signature takes the persisted rounds with an optional
  attempt. `FlagWidget` untouched.
- `src/app/lib/gate-store.ts` — `PHASE_LINES.exhausted` loses its hardcoded round count. Its only
  consumer is the panel: the toast's parameter type excludes `exhausted`.
- `src/app/components/story-card.tsx` — both the badge's render condition (`:35`, `:50`, which
  today short-circuits to nothing without a live attempt) and its call follow `gateBadgeLabel`'s
  new signature, so "gate spent" renders from persisted history alone.
- `src/app/components/card-drawer.tsx` — the one `<GatePanel>` call site passes `story`.
- `.helm/knowledge/architecture/board-storage.md` §Story file — the `gate` block's example and
  its paragraph describe the persistent record: rounds accumulate as they are spent, and the
  record exists only while the story is refining. The frontmatter-writing rule at `:148-151`
  ("one flow-styled run per line, so a rewrite diffs as exactly the lines that changed") gains
  the `gate` container's conditional block styling.
- `.helm/knowledge/product/features/define-refine.md` §Ready gate — two stale statements: the
  "After the second round the gate surfaces the round history and waits" sentence (`:149-150`),
  which now describes a surface fed from the file, and the "**The verdict persists in frontmatter
  and binds to the brief.** A pass writes the story's `gate` block" paragraph (`:152-158`), which
  stops being the only thing that writes the block.
- `.helm/knowledge/architecture/api.md` — the `gate` channel bullet's "Attempts are in-memory
  only; the durable outcome is the story's `gate` frontmatter block" sentence (`:71-78`); and the
  `board` channel's story payload (`:37`) carrying the widened block.
- Behavioral reach: every gate state change schedules a frontmatter write on that one story,
  skipped unless the record actually changed — on the order of 2k writes for a k-flag round,
  spread across minutes. No RPC contract change and no `gate`-channel shape change; the board
  channel's story payload widens.

## Acceptance criteria

- [ ] In `src/board/schema.ts`, the `gate` schema rejects unknown keys, carries a refinement
      making `passed` and `brief` valid only as a pair, keeps `overrides`, and adds a `rounds`
      array of `{ n, flags: [{ title, status }] }` defaulting to `[]`; the flag-status enum is
      defined in this file and `src/shared/gate.ts` imports it, so the two files import in one
      direction only. (file)
- [ ] `writePass` in `src/server/services/gate.ts` type-checks against the widened `Gate` output
      type: its `Gate` literal carries `rounds` explicitly. (file)
- [ ] In `src/board/markdown.ts`, `stringifyFrontmatter` flow-styles the `gate` map only while
      both `rounds` and `overrides` are empty, block-styles `rounds`, each round's `flags` and
      `overrides` as sequences otherwise (each flag a flow map on its own line), and
      `serializeStory` drops the `gate` key when it holds no verdict, no rounds and no
      overrides — so no line's length grows with the number of flags or overrides, and a cleared
      record leaves no `gate: { overrides: [] }` residue. (file)
- [ ] Every `gate` block already on disk still parses with no migration and still reads as a valid
      verdict: the board loads with no new `invalid` entry and all 15 committed blocks' cards
      render. A story move that rewrites one of those 15 (empty `overrides`) leaves its `gate:`
      line unchanged in `git diff`; a rewrite of a block carrying overrides converts it to a block
      map once, with the same values. (live)
- [ ] A story hand-edited to carry `passed` without `brief` (or the reverse) surfaces in the
      invalid banner with the parse message, rather than rendering as a passed gate. (live)
- [ ] `verdictValid` in `src/board/transitions.ts` is unchanged and returns false for a `gate`
      block that carries history but no `brief`, at every caller (`canTransition`, `gate.ts:152`,
      `runs.ts:353`, `runs.ts:629`'s run-start init write, the client pre-check) — no history-only
      block is ever read as a verdict. (file)
- [ ] `broadcast` in `src/server/services/gate.ts` takes the changed attempt, all ten call sites
      pass it (including `abort`'s at `:80` and `onClosed`'s loop, which passes each attempt as it
      iterates), and `persistGate` is scheduled for that attempt alone — one story's write per
      state change, never a fan-out across the map. (file)
- [ ] `persistGate` is called from `broadcast` and from no other site in
      `src/server/services/gate.ts`, so every state change that reaches the UI reaches disk,
      including the direct phase assignment at `:538` and every abort path. (file)
- [ ] `persistGate` is synchronous and schedules its write with an un-awaited `enqueueWrite`
      carrying its own `.catch`, so no call path awaits the write queue from inside a queued task
      (`writePass`'s body, `requestReady`'s handler) and no failure of it can reach `evaluate`'s
      `.catch(logAndAbort)` callers or abort an attempt. (file)
- [ ] Inside the scheduled write (not at call time), the task re-reads the story and writes
      nothing when the story's status is not `refining`, nothing when the attempt has no rounds,
      and nothing when the computed `gate` block equals the parsed block already on disk. No
      ownership test on the map exists: an already-deleted attempt (the abort path, whose
      broadcast fires after `attempts.delete` at `gate.ts:79-80`) writes, and so does a
      superseded one, each touching only its own entries. (file)
- [ ] The write is append-only: a round of this attempt not yet on disk takes
      `n = disk.rounds.length + 1`, the attempt remembers that number, and every later write of
      that round upserts by it — no slice, no captured offset, so interleaved writes and
      hand-added rounds are never truncated. `passed`, `brief` and `overrides` are preserved
      verbatim from the story just read and the body is written back unchanged. (file)
- [ ] A round enters the record at its push (`gate.ts:212`), so a round interrupted before its
      verdict — a failed spawn (`:194-200`), an unreadable story after the run (`:223-228`), a
      service stop — is recorded, and a round discarded by a mid-flight brief edit (`:230-236`)
      keeps the flags it raised at the status they had reached. Flag statuses are the last known
      state, not a closed verdict. (file)
- [ ] All three exits out of `refining` drop `rounds` in the same write: `writePass`'s pass
      (`gate.ts:336-340`), `requestReady`'s recorded-verdict fast path (`:152-158`), and the
      `story.move` route (`src/worker/routes/story.ts:60-99`) for every transition leaving
      `refining`. All three also drop the live attempt: `writePass` through its `abort` at
      `:350`, and the fast path and `story.move` through a new gate entry point — `story.move`
      calling it inside the queued task *after* validation passes, so a rejected move never kills
      a live attempt. No surviving attempt can restore a record that was just cleared. (file)
- [ ] `GatePanel` in `src/app/components/gate-panel.tsx` takes the story and splits its outer
      guard: the phase line, `data-gate-phase` and the flag widgets render only with a live attempt
      from `gateFor(story.id)`, while the history box renders from `story.frontmatter.gate?.rounds`
      (optional-guarded) when the story is `refining` and the list is non-empty, with or without a
      live attempt. With neither a live attempt nor a record, the panel renders nothing.
      `card-drawer.tsx` passes `story`. (file)
- [ ] `RoundHistory` renders the persisted rounds — each round's number and its flags' titles with
      `FLAG_BADGES` keyed off the persisted status, including flags frozen at `open`/`contested`
      by an interrupted attempt — and no longer renders an `overrides` list. The `exhausted`-only
      block at `gate-panel.tsx:203-211` keeps only its "Move the card to Ready…" line; the history
      it used to render comes from the file, in every phase and with none. (file)
- [ ] `gateBadgeLabel` takes the persisted rounds with an optional live attempt: with an attempt
      it returns exactly today's labels ("gating" / "flags" / "gate blocked"), and only with no
      attempt and a non-empty record does it return "gate spent". (file)
- [ ] `PHASE_LINES.exhausted` in `src/app/lib/gate-store.ts` states no round count. (file)
- [ ] With 005-05's stub on `PATH` against a scratch target repo (claude-integration.md
      §Verifying without burning the pool), a flagged round on a refining story writes round 1 to
      the story file with its flag titles and their statuses as they resolve; restarting the
      orchestrator and running another leaves the file carrying **two** rounds numbered 1 and 2 —
      the accumulation across a restart, at zero pool cost. (live)
- [ ] On the same setup, a round whose adversary spawn fails (the `enqueueRound` catch at
      `gate.ts:194-200`) leaves its round recorded in the story file with the story still in
      `refining` — the interrupted round that vanishes today. (live)
- [ ] On the same setup, dragging a refining story with a recorded round to `backlog` clears
      `gate.rounds` from its file; dragging it back and running another round writes a record
      starting at round 1 (the dropped attempt did not restore the old one); and a passing round
      on another story clears the record as the card lands in Ready. (live)
- [ ] On the same setup, a story whose file already carries two rounds and a non-empty `overrides`
      list, then written again by a live round, serializes `gate` as a block map — `rounds`, its
      `flags` and `overrides` each a block sequence, no line growing with the list length — with
      the existing rounds preserved and the new one appended as round 3. (live)
- [ ] On the same setup, a two-round attempt driven to `exhausted` shows, in the drawer, the phase
      line and `data-gate-phase` from the live attempt, its contested flag's widget, the
      file-driven history box, and the "Move the card to Ready to run another adversary pass."
      line — both halves of the split guard, and the exhausted copy carrying no round count. (live)
- [ ] On a scratch target repo with the orchestrator freshly started (so no attempt is in memory),
      a refining story hand-written with three rounds of flags shows, in the drawer, the cumulative
      count and each round's flags with their resolutions, and its board card shows the "gate
      spent" badge. (live)
- [ ] On the same scratch repo, the identical history on a story that is *not* refining (e.g.
      `ready`) renders no history box and no badge. (live)
- [ ] `pnpm check` passes. (command)
- [ ] `.helm/knowledge/architecture/board-storage.md` §Story file documents the `gate` block as the
      persistent record — the example shows `rounds`, the prose states that rounds accumulate as
      they are spent and that the record exists only while the story is refining, and the
      frontmatter-writing rule at `:148-151` covers the `gate` container's conditional block
      styling. (file)
- [ ] `.helm/knowledge/product/features/define-refine.md` §Ready gate's two stale statements are
      corrected: the second-round wait sentence (`:149-150`) describes a surface fed from the file,
      and the verdict-persists paragraph (`:152-158`) no longer implies a pass is the only thing
      that writes the `gate` block. (file)
- [ ] `.helm/knowledge/architecture/api.md` no longer states that a gate attempt's durable outcome
      is only a pass (the `gate` channel bullet at `:71-78`), and the `board` channel's story
      payload (`:37`) is described as carrying the widened block. (file)

## Out of scope

- The round budget, the escalation surface, the digest session and its new session kind: 005-04
  refines against this record once it exists.
- Reseeding the refine session on a retry (005-02) and delta rounds (005-03).
- Any force-through, override-all, or manual history-reset affordance.
- Changing the two-automatic-round cap, the flag routing, or the dismissal register's semantics.
- Persisting flag `detail` bodies or a dismissal's override reason: the record carries titles and
  statuses, and 005-04 decides what its digest needs beyond them.
- Clearing the record after a hand-edited status change: the orchestrator's own writes are the
  three clear sites, and a hand edit is the user's to undo (files are the truth).
- Surfacing gate history anywhere but the story drawer and the card badge (no board-level view,
  no cross-story rollup).

## Open questions
