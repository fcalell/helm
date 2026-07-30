---
id: 005-07
status: ready
depends: [005-05]
gate: { passed: 2026-07-30T17:32:24.434Z, brief: 89193042aa29059d, overrides: [] }
sessions: {}
---
# Deterministic episodes

## Goal

An episode that fails one run in five proves nothing, and four committed ones do exactly that.
`one-flag` failed 3 of 6 isolated runs and `exhausted` 2 of 4, at `5f1461c` and at `7501327` alike;
at HEAD `gate-reseed-retry` and `gate-reseed-park` each fail 1 in 5 while the single-round
`gate-reseed-not-on-record` is clean at 5/5. 005-06's review and 005-02's both had to re-run every
new episode in isolation to tell a real failure from the noise, and 005-02 now sits in review with
its suite criterion failed on this alone.

The cause is a defect in the product, measured rather than inferred. Board writes are not atomic:
`writeStory` is a bare `writeFile` (`src/board/store.ts:448-456`), so the file is truncated and
refilled in two steps, and any reader outside the write queue can catch it between them. A probe
writing a story-sized body in a loop against a concurrent reader saw 1073 torn reads in 37725, 2.8%.
`runRound`'s read (`gate.ts:278`) is one of those readers: a torn read throws,
`.catch(() => undefined)` turns it into "story left refining; attempt aborted", the round's flag
never reaches the gate channel, and `waitForFlag` times out at 45 s. That timeout is the observed
symptom, and its rate scales with the writes a story's gate performs, which is why the three-round
episodes fail and the one-round one does not.

The flakiness is the cheapest symptom. `routeFlags` reads the same way (`gate.ts:321`) and fails
silently: an undefined story leaves `refineId` undefined, so `concedeToReview` runs (`:323-326`) and
every flag in the round is conceded without a refine session ever seeing it. A user's gate round
would quietly concede its flags and move to review with nothing to show why.

This replaces the diagnosis this card carried. The observer's last-write-wins sampling
(`observer.ts:86-113`) is not the cause, and `waitForFlag`, `waitForPhase` and `waitForReady` are
not touched here. The harness is the instrument every later story in this epic grades its `(live)`
criteria against, so the repair carries a measurement that shows the race closed, not narrowed.

## Approach

Measured at `c37f608`, re-checked at `913929e` (board-only commit since, no code anchor moved).

- **Four writers are bare, and the temp-and-put-in-place fix has one home.** `writeStory`
  (`store.ts:448-456`), `writeEpic` (`:458-466`), `writeShaping` (`:487-495`) and
  `createShapingThread` (`create.ts:74-78`) each call `writeFile` on the target path; those four are
  every `writeFile` call in `src/board/`. `rename(2)` is atomic within a filesystem, so a writer
  that fills a temp file in the same directory and renames it over the target leaves no window in
  which a reader sees anything but the old file or the new one.
- **The fourth writer's exclusivity is load-bearing, so it converts through `link` rather than
  `rename`.** `createShapingThread` writes `.helm/board/shaping/<slug>.md` under `flag: "wx"`, and
  its comment (`create.ts:63-65`) says the slug must be free. Something depends on that throw:
  `createShapeThread` (`sessions.ts:559-575`) catches it through `isEEXIST` (`:555-557`) and mints
  `<base>-2`, `<base>-3` until a slug is free. `rename` clobbers unconditionally, so a plain
  conversion would not error, it would overwrite a live shaping thread. `link(temp, path)` is atomic
  on POSIX and fails with `EEXIST` when the target exists, the same code the caller already matches
  on, so both properties survive. Scoping this writer out instead would leave the shaping thread as
  the one board file that can still be read half-written, and it is read outside the queue by the
  watcher (`watcher.ts:143`), by `scanBoard` (`store.ts:392`), by the MCP open-decisions read
  (`mcp/tools.ts:83`) and by `readShapingThread` (`proposals.ts:594`).
- **A torn read is a truncated or empty file, and it surfaces as a missing fence.** `readStoryFile`
  (`:208-234`) reads the whole file, then `parseFrontmatter` throws `InvalidBoardFileError`
  "missing frontmatter fence" when `splitFrontmatter` finds none (`:187-190`). Every tear the probe
  caught was that shape, consistent with the truncate window rather than a partial body.
- **Reads inside the write queue cannot tear; only reads outside it can.** `enqueueWrite`
  (`write-queue.ts:6-13`) serializes one global chain, and no `writeStory`, `writeEpic`,
  `writeShaping` or `createShapingThread` call site sits outside a queued task. So a read that runs
  inside a queued task is ordered against every write by construction. That splits `readFresh`'s
  callers exactly: `:163` (inside `:162`), `:210` (inside `:209`), `:455` (inside `:454`) and `:645`
  (inside `:644`) are safe; `:278`, `:295`, `:321` and `:429` are not.
- **Each exposed gate read fails differently, and one fails silently.** `:278` aborts with "left
  refining", `:295` with "unreadable after a round" (`:296-301`), `:429` with "unreadable"
  (`:430-434`). `routeFlags` (`:321`) is the quiet one: an undefined story leaves `refineId`
  undefined, so `concedeToReview` runs (`:323-326`) and every flag is conceded without a session
  ever seeing it.
- **The exposed readers are not only the gate's, which is why the writers are the fix and not
  `readFresh`.** Reading outside the queue: the watcher's three reads (`watcher.ts:95`, `:112`,
  `:143`), the refine seed (`sessions.ts:501`), the card raw for all three kinds (`:670`, `:673`,
  `:675`), `readStoryOrApiError` from its seven unqueued callers (`runs.ts:488`, `:1040`, `:1153`,
  `:1167`, `:1194`, `:1274`, `review.ts:59`), and the MCP open-decisions read (`mcp/tools.ts:83`).
  One atomic write closes all of them at once; queueing `readFresh` closes one.
- **Queueing `readFresh` would also deadlock.** `enqueueWrite` sets `writeQueue` to a promise
  derived from the task it just scheduled (`write-queue.ts:7-8`), so a nested call from inside a
  queued task waits on its own caller. Four of `readFresh`'s eight call sites are inside queued
  tasks, so the change hangs the gate on its first persist.
- **The watcher has the same exposure and needs no change of its own.** `readStory` catches the
  throw, drops the story and calls `markInvalid` (`watcher.ts:134-138`), which reaches the board
  channel's `invalid` array (`board/schema.ts:227-232`) and renders as the banner
  (`app/lib/board-store.ts:84-86`, `app/components/invalid-banner.tsx`). `awaitWriteFinish`
  (`:297`) narrows the window but does not close it: it delays the event, and a write starting
  after the event still tears the read. The atomic write closes it.
- **The put-in-place is invisible to the board, by the temp file's name.** `classify` returns
  `ignored` for any dot-prefixed entry at epic-directory level (`store.ts:94`), story level
  (`:110`) and shaping level (`:131`), so `.${basename}.tmp` is not a board file to `scanBoard` or
  to the watcher's `handleFile`. The temp's own `unlink` event is harmless too: `handleUnlink`
  (`watcher.ts:224-249`) finds the path in no map, `storyOrdinal` rejects the name, and it falls
  through to a `deleteEpic` that changes nothing.
- **A rename still reaches the watcher, and the suite is what proves it.** `watcher.on("add")` and
  `watcher.on("change")` both call `handleFile` (`:299-300`), so whichever event chokidar picks for
  a rename over an existing path, the file is re-read. Every episode assertion about the durable
  record reads `ctx.obs.board()` (`driver.ts:83-84`), which is the watcher's snapshot, so a rename
  the watcher missed would turn the whole suite red rather than hide.
- **The harness can detect a torn watcher read, and today it cannot.** The observer keeps `phases`,
  `flagStatuses` and `closed` as accumulated history (`observer.ts:92-113`) but holds `board` as a
  last-write-wins value (`:86-87`), so an `invalid` entry that appears and heals between two board
  frames leaves no trace. Accumulating the `invalid` paths turns all 15 unattended episodes into
  detectors for the watcher's exposure at the cost of one map.
- **That accumulator cannot live on the observer, because an episode outlives its socket.**
  `runEpisode` holds `obs` as a reassignable binding and `ctx.restart()` closes the socket and swaps
  it (`driver.ts:359-371`), while the post-run checks read whatever it points at then (`:381-394`).
  `gate-history-restart` (`episodes.ts:454-477`) is unattended and does its first gate write, its
  record read and its watcher re-read before the restart, so an accumulator owned by `observe()`
  would be thrown away exactly where the detector is most wanted. The map's lifetime is the episode,
  so `runEpisode` owns it and passes it to both `observe()` calls.
- **A repeated pass count cannot prove a race closed on its own.** It shows the rate fell. The
  proof that the window is gone is the writer's shape plus a direct probe with a control arm: the
  same loop run against a bare `writeFile` and against `writeStory`, where the bare arm tearing is
  what makes zero tears in the other arm mean anything. Alternating two versions of the same file
  and demanding every read equal one of them detects a truncated read and a partial-body read
  alike, without assuming which shape occurs.
- **`exhausted` runs unattended when its stdin is closed.** Its `halt` is the last beat
  (`episodes.ts:284-287`), after every assertion, and `halt` resolves false on stdin end
  (`driver.ts:319-332`), so `run.ts exhausted < /dev/null` grades the episode fully. `run.ts all`
  filters the four halting episodes out (`run.ts:17-20`), so `exhausted` is measured by name or not
  at all.
- **The fixture's size is not what makes the race reachable.** The scratch story body is about 600
  bytes (`scratch.ts:50-76`) and the episodes fail at 20% anyway, because the window is the gap
  between truncate and write rather than the length of the write. The probe uses a story-sized 40 KB
  body only to make the control arm's signal loud.

Changes:

1. **One atomic writer under four names.** `src/board/store.ts` gains a private
   `writeAtomic(path, contents, exclusive)`: `writeFile` to
   `join(dirname(path), ".${basename(path)}.tmp")`, then `rename` onto `path`; when `exclusive`,
   `link(temp, path)` inside a `try` whose `finally` unlinks the temp, so the `EEXIST` reaches the
   caller and no temp is left behind either way. The temp lives in the target's directory because
   rename and link are atomic only within a filesystem, and its name is fixed rather than unique
   because no two board writes overlap.
2. **`writeShaping` takes the exclusive flag, and `create.ts` stops hand-rolling its write.**
   `writeShaping(thread, options?)` passes `options?.exclusive === true` through to `writeAtomic`;
   its three existing call sites (`store.ts:502`, `proposals.ts:318`, `:361`) pass nothing and keep
   today's behavior. `createShapingThread` (`create.ts:74-78`) calls `writeShaping` with
   `{ exclusive: true }`, which drops its `writeFile` and `serializeShaping` imports and makes the
   three creators symmetric: `createEpic` through `writeEpic`, `createStory` through `writeStory`,
   `createShapingThread` through `writeShaping`.
3. **The harness sees an invalid file even if it heals, and even across a restart.** `runEpisode`
   owns a path-keyed `Map<string, string>` for the episode and passes it to `observe()`, which
   appends every `invalid` entry from each board snapshot into it, alongside the existing `phases`
   and `flagStatuses` accumulators. `ctx.restart()` passes the same map to the replacement observer.
   The post-run check list (`driver.ts:381-394`) gains one check that fails the episode when the map
   is non-empty, naming the path and message.
4. **A two-arm probe under `spikes/torn-read/`.** `probe.ts` writes two versions of one story file
   in a loop while a second task reads it, counting reads that are byte-equal to neither version or
   that throw. It runs both arms in one process: a control writing through `writeFile` and the
   product's `writeStory`. `README.md` records the command, the counts and the node version, the
   shape `spikes/harness-feasibility/README.md` already uses.
5. **The doc says writes are atomic.** `board-storage.md` §Mutation rules gains a bullet under the
   single-writer one: board files are written to a dot-prefixed temp in the same directory and put
   in place with a single atomic operation, so a reader outside the write queue never sees a partial
   file, and reads are deliberately not serialized behind the queue.

## Blast radius

- `src/board/store.ts`: one new private `writeAtomic`, three writers rerouted through it,
  `writeShaping` gains an optional `exclusive`, `rename`, `link` and `unlink` added to the
  `node:fs/promises` import. `readStoryFile`, `readEpicFile`, `readShapingFile`, `classify`,
  `scanBoard`, `loadBoard`, `attachEpicSession` and `attachShapingSession` untouched; the two attach
  helpers inherit the fix through their writers.
- `src/board/create.ts`: `createShapingThread`'s body writes through `writeShaping` with
  `exclusive: true`; the `writeFile` and `serializeShaping` imports drop, `mkdir` stays. Its
  signature, its return and the `EEXIST` it throws are unchanged. `createEpic` and `createStory`
  untouched.
- `src/server/services/sessions.ts`: zero diff. `createShapeThread`'s `isEEXIST` retry loop
  (`:555-575`) keeps working because `link` sets the same code.
- `src/server/write-queue.ts`: zero diff. No read moves into the queue and no call site is added.
- `src/server/services/gate.ts`: zero diff. `readFresh` and all eight of its call sites stay as
  they are.
- `src/board/watcher.ts`: zero diff. Its three reads inherit the fix, and `awaitWriteFinish` keeps
  its current thresholds.
- `harness/episode/driver.ts`: an episode-scoped invalid map, passed into both `observe()` calls,
  plus one post-run check. `harness/episode/observer.ts`: the map parameter and the append on the
  board snapshot branch. No episode changes, no declaration changes, `EPISODES` stays at 19 with 4
  halting.
- `spikes/torn-read/`: new, two files. Nothing imports it.
- `.helm/knowledge/architecture/board-storage.md` §Mutation rules.
- Behavioral reach: every board write costs one extra filesystem operation and replaces the target's
  inode, so an fd opened before a write keeps serving the old content and the file's inode number
  changes on every write. Nothing in the repo holds a board fd open across a write. A crash between
  the write and the put-in-place leaves a dot-prefixed temp that the board ignores and the next
  write overwrites. Custom file modes are not preserved, since the renamed temp carries its own. No
  format change, no RPC contract change, no WS shape change, and no change to any gate or run
  behavior beyond the aborts that stop happening.

## Acceptance criteria

- [ ] `writeStory` (`store.ts:448-456`), `writeEpic` (`:458-466`), `writeShaping` (`:487-495`) and
      `createShapingThread` (`create.ts:66-80`) all write through a single private
      `writeAtomic(path, contents, exclusive)` in `store.ts` that fills a temp file in
      `dirname(path)` and then puts it in place. The only `writeFile` call left in `src/board/` is
      the one inside `writeAtomic`, and `create.ts` imports neither `writeFile` nor
      `serializeShaping`. The four writers keep their signatures and their return types. (file)
- [ ] The exclusive create survives the conversion. `writeShaping(thread, options?)` passes
      `options?.exclusive === true` to `writeAtomic`, which then puts the temp in place with
      `link(temp, path)` rather than `rename`, inside a `try` whose `finally` unlinks the temp.
      `link` throws `EEXIST` when the target exists where `rename` would clobber it, which is the
      code `createShapeThread` matches on through `isEEXIST` (`sessions.ts:555-557`) to mint
      `<base>-2` (`:559-575`); a dropped throw would silently overwrite a live shaping thread rather
      than error. `createShapingThread` is the only caller passing `exclusive`, so `store.ts:502`,
      `proposals.ts:318` and `:361` keep today's clobbering rename. (file)
- [ ] Starting two shaping threads whose opening line is identical, through a running orchestrator,
      leaves two files in `.helm/board/shaping/`: `<slug>.md` and `<slug>-2.md`, both with valid
      frontmatter and the second holding the second thread's seed. This is the behavior the `wx`
      throw bought, and it is the one thing the conversion could silently take away. (live)
- [ ] The temp file is named `.${basename(path)}.tmp`, so `classify` returns `ignored` for it at
      every depth it can appear: epic-directory entries (`store.ts:94`), story and `epic.md` entries
      (`:110`) and shaping entries (`:131`). Read those three branches against the name; a temp that
      is not dot-prefixed is a banner in the UI for as long as it exists. (file)
- [ ] `src/server/write-queue.ts` and `readFresh` (`gate.ts:129-152`) are byte-unchanged, and no
      `enqueueWrite` call site is added anywhere, proved by `git diff` over both files and a grep
      for `enqueueWrite`. Four of `readFresh`'s eight call sites already run inside queued tasks
      (`:163`, `:210`, `:455`, `:645`), so queueing the read would wait on its own caller. (file)
- [ ] `node spikes/torn-read/probe.ts` runs both arms and prints a torn count per arm over at least
      20000 reads each. Pass is numeric and needs both halves: the control arm writing through
      `writeFile` reports **more than zero** torn reads, which is what proves the probe can see a
      tear at all, and the arm writing through `writeStory` reports **exactly zero**. At the
      measured 2.8% an unfixed writer would show roughly 560 tears over 20000 reads. Both counts,
      the read totals and the node version land in `spikes/torn-read/README.md`. (live)
- [ ] The invalid-file detector belongs to the episode, not to a socket. `runEpisode` creates a
      path-keyed map, passes it to `observe()` and to the observer `ctx.restart()` builds
      (`driver.ts:359-371`), and the observer appends every `invalid` entry from every board
      snapshot into it, because `board` is last-write-wins (`observer.ts:86-87`) and an entry that
      heals between two frames leaves no other trace. A map owned by `observe()` would be discarded
      at the restart, blinding the detector across `gate-history-restart`'s pre-restart half
      (`episodes.ts:454-477`), which is where that episode's gate write and watcher re-read happen.
      `runEpisode`'s post-run check list (`driver.ts:381-394`) gains a check that fails the episode
      when the map is non-empty and names the path and message it holds. (file)
- [ ] `node harness/episode/run.ts all` reports 15/15 on **10 consecutive runs**, with the invalid
      check from the criterion above in place, and `node harness/episode/run.ts exhausted <
      /dev/null` passes on 10 consecutive runs (it halts as its last beat, `episodes.ts:284-287`, so
      a closed stdin still grades every assertion). Every count lands in the run notes. Ten clean
      suite runs is the evidence because the suite carries the previously flaky episodes: at
      `one-flag`'s measured 3-in-6 rate alone, ten clean runs happen under 1 time in 1000, and
      `gate-reseed-retry` and `gate-reseed-park` each contribute 10 more samples against their
      1-in-5. A single failure in any of the 20 runs leaves this unchecked, with its message
      recorded against the episode that produced it. (live)
- [ ] With `node harness/episode/run.ts exhausted` held at its halt, the drawer shows both rounds in
      the file-driven history box and the board shows no invalid-files banner
      (`app/components/invalid-banner.tsx`). This is what proves the watcher still observes a
      rename: the history box reads the durable record, which reached the UI through
      `watcher.on("change")` into `handleFile` (`watcher.ts:299-300`). (live)
- [ ] `pnpm check` passes. (command)
- [ ] `.helm/knowledge/architecture/board-storage.md` §Mutation rules states that board files are
      written to a dot-prefixed temp in the same directory and put in place with a single atomic
      operation, so a reader outside the write queue never sees a partial file, and that reads are
      not serialized behind the write queue. (file)

## Out of scope

- `waitForFlag` (`driver.ts:154-169`), `waitForPhase` (`episodes.ts:92-99`), `waitForReady`
  (`driver.ts:222-238`), the observer's 50 ms poll and its 45 s deadline (`observer.ts:35-36`), and
  every last-write-wins snapshot other than `invalid`. This card's original diagnosis is withdrawn,
  not repaired.
- Moving any read into `enqueueWrite`, and the queue's per-repo TODO (`write-queue.ts:3`).
- `fsync` on the temp file or its directory. The put-in-place closes what a concurrent reader can
  see; it makes no promise about a power loss, and this story measures nothing about crash
  durability.
- Any change to `awaitWriteFinish`, chokidar options, or the watcher's read, heal and invalidation
  logic. It inherits the fix and diffs zero.
- `createShapeThread`'s dedupe loop (`sessions.ts:559-575`), the slug it mints and the `-2` suffix
  shape. The conversion preserves the `EEXIST` it feeds on; the loop itself is untouched.
- Writes outside `src/board/`: `helm.config.json`, worktree files, transcripts, the harness scratch
  fixtures (`scratch.ts`) and the stub's spawn log.
- Any episode's beats, scripts, spawn declarations or round counts, and the halting four staying
  by-name. `EPISODES` neither grows nor shrinks.
- Re-running 005-02's suite criterion and moving it out of review. That happens on 005-02's card
  once this lands.
- The malformed-session-event crash recorded in `spikes/harness-feasibility/README.md`.

## Open questions

- [x] The torn-read probe lives in `spikes/torn-read/`, committed with a README recording its
      counts and node version: CLAUDE.md defines `spikes/` as throwaway reference scripts, one
      folder per spike, and `spikes/harness-feasibility/` is the precedent. `harness/` is the stub
      plus the episode driver, and a torn-read probe is neither.
- [x] The episode evidence is 10 consecutive clean runs of `run.ts all` plus 10 of `exhausted` by
      name. Ten samples `one-flag` against its measured 3-in-6 rate, under 1 in 1000 by chance, and
      both reseed episodes against their 1-in-5; five would leave a 1-in-5 episode a third of a
      chance at a false clean sweep.
