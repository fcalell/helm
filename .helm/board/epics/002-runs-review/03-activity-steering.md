---
id: 002-03
status: done
depends: [002-01]
branch: helm/002-03-activity-steering
gate: { passed: 2026-07-20T10:58:15.293Z, brief: ba8a0df171f3bd78, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: 94ab713d-1c13-441c-88d7-0cadb2a28456, brief: ba8a0df171f3bd78, started: 2026-07-20T11:04:20Z, outcome: review, grades: 9/10, tokens: 460390, minutes: 20.2 }
---
# Activity timeline & steering

## Goal

The drawer's Activity tab streams a run live: assistant narration surfaced, tool calls collapsed
to one-liners, file edits as inline mini-diffs. A steering box injects a user message by killing
the process and resuming the session with a notice that the previous action was interrupted;
pause and stop are always available (`.knowledge/product/features/runs.md` §Activity timeline &
steering). Pure UI over the stream 002-01 forwards, the epic's counterpart of 001-03.

## Approach

**Activity tab.** A new `ActivityPane` (`src/app/components/activity-pane.tsx`) replaces the
Activity tab's placeholder in `card-drawer.tsx`. It binds to one session id: the open run entry's
`session`, else the latest entry's (a finished run's stream stays viewable), else an empty state.
The id is stable across resumes (claude-integration.md §Invocation model), so every segment of a
steered or answered run lands in the same timeline. Items come from the session store's existing
per-session `ChatState` (`chatFor`), which the 002-01 broadcast already populates for run
sessions; no new wire plumbing. Rendering: assistant text as narration, user items (the steering
and answer prompts echo as `user` events) as the chat pane's user bubble, and tool calls as
collapsed one-liners, except `Edit` and `Write`, which render as inline mini-diffs. The
one-liner (`ToolCallLine` with `summarizeInput`) moves out of `chat-pane.tsx` into its own
component file both panes import; the chat pane's behavior is unchanged. The mini-diff is a new
small component: file path header, then `old_string` lines styled removed and `new_string` lines
styled added (`Write` shows `content` as all-added), truncated into a scrollable max-height
block; no word-level diffing. The pane keeps the chat pane's autoscroll effect and shows a
working indicator while the session is `busy`.

**Brief-edit notice.** The open entry's `brief` field is the spawn snapshot's hash. When
`briefHash(story.body)` (imported from `src/board/hash.ts`, a pure function) differs from it,
the pane shows a static notice: the brief was edited since spawn and takes effect on the next
attempt (runs.md §snapshot rule, deferred here by 002-02). No new state, computed per render.

**Steering, pause, stop: run-lifecycle paths.** `messageSession` deliberately rejects run
sessions, so steering lives on the runs service (`src/server/services/runs.ts`) beside
`answerRun`, whose wait-claim-resume shape it shares; the common plumbing (bounded teardown
wait, synchronous slot claim, worktree/settings/preset rebuild, `spawnRunSession` resume,
armed init write) is factored into a helper both use rather than copied. The helper
parameterizes three caller-owned pieces, not the init write alone: the up-front precondition
(`answerRun`'s status `needs-input` with a pending question on the open entry stays its own;
steering requires status `running` with an open entry and no question requirement), the resume
prompt, and the init-write re-check. `RunState` gains an
`intent?: "steer" | "pause" | "stop"` field, set synchronously before the kill so `finishRun`
can tell a deliberate kill from a crash:

- **`steerRun(storyId, message)`**: requires status `running`. With a live state: set intent
  `steer`, kill the process group, await `closed` bounded by the `run.answer` 60s standard.
  Then (or immediately, when no state exists because the run is paused) claim the slot and
  resume the open entry's session with `steeringPrompt(message)`, which already states the
  interruption. The queued init write re-checks status `running` with an open, question-free
  entry, and deletes `paused` when set; an aborted write means the user's move (or a racing
  `ask_user`) won, rejected with the ILLEGAL_TRANSITION shape `answerRun` set. An absent
  message means the Resume button: the server substitutes the fixed message "Continue the
  run." so a bare resume still carries the interruption notice.
- **`pauseRun(storyId)`**: requires status `running` and a live state (a paused run has no
  process; pausing it is rejected). Set intent `pause`, kill the group, await `closed`, so the
  caller returns after the paused write landed.
- **`stopRun(storyId)`**: requires status `running` or `needs-input`. With a live state, which
  a needs-input card can transiently hold (the `ask_user` flip lands while the asking process
  is still tearing down, the same window `answerRun` waits out): set intent `stop`, kill,
  await `closed`, and the intent-aware close below writes the blocked exit with the segment's
  usage kept. Without one (paused, or needs-input with the teardown finished): one queued
  write closes the open entry directly with the same fields the intent path writes. Either
  way a pending `question` stays on the entry as record, the 002-02 crash-path precedent.

**Close handling per intent.** `finishRun` decides in a fixed order, intent-aware. First, any
observed completion on a question-free entry is a genuine finish and the normal mapping runs
with the intent ignored: a result event (clean → Review, error → Blocked with its text) and
equally the hook-posted completion with no observed result frame, which today maps to Review
and is spike-verified to fire only on clean finishes; the run ended on its own before the
kill landed, so the completion wins whether it arrived as a result or as the Stop-hook POST.
Second, the
teardown `error` path keeps today's authority over every intent: a group that survives
SIGKILL, a failed safety commit, or a committed `.helm/` violation forces `outcome: blocked`
with that error, never a segment end, because a pause or steer written over an uncommitted or
still-running tree would mask the failure (and, for a survivor, leave an orphan the pid sweep
cannot reap while inviting a second spawn into the same worktree; the steer path needs no
extra guard for this, its init-write re-check aborts once the status reads `blocked`).
Third, `stop` comes before the question check: it closes the entry `outcome: blocked`,
`error: "stopped by the user"`, status → `blocked` (legal from `running` and `needs-input`
alike), with the question kept as record, because a stop that raced an `ask_user` teardown
must still park the card rather than be swallowed by the segment end. Then the existing
question segment-end runs, so a racing `ask_user` beats `steer` and `pause`. Last, for a turn
that ended without a clean result: `steer` is a plain segment end (usage accumulates, no
outcome, status untouched); `pause` is the same segment end plus `paused: true` written on
the open entry; no intent keeps today's crash mapping. The
`paused` flag is a new optional boolean on `runSchema` (`src/board/schema.ts`), written only as
`true` on the open entry, deleted by the resume's init write and never present on a closed
entry (the stop and finish writes drop it).

**Restart.** A paused story is `running` on disk with no live process, exactly what
`reconcileRunning` today parks in Blocked. It gains one guard: a `running` story whose open
entry carries `paused: true` is left intact (its segment's safety commit ran at pause time; the
pid sweep is independent and unaffected), so pause survives an orchestrator restart and Resume
still works, the persistence standard the needs-input question set. A crashed, non-paused
running story still parks Blocked.

**Routes and client.** `src/worker/routes/run.ts` gains `steer {id, message?}`, `pause {id}`,
`stop {id}`, thin wrappers over the service; `.knowledge/architecture/api.md` records them.
`session-store.ts` gains the matching actions with the existing toast-on-error shape. In the
pane: the steering box (textarea + Steer button, the chat input's layout only, deliberately
not its behavior: the chat input disables on the session's `busy`, while steering exists
precisely to interrupt a busy run, so the box gates on its own in-flight RPC alone) and a
control row.
Controls render by state: Pause and Stop while a live segment runs, Resume and Stop while
paused, Stop alone on needs-input (the question panel owns answering), nothing once no entry is
open. Buttons disable while their RPC is in flight.

**Docs.** `board-storage.md` §Story file: the `paused` run-entry field. `api.md`: the three
procedures. `runs.md` already specifies steering, pause/stop, and the brief-edit notice;
no feature-doc change.

## Blast radius

- `src/app/components/activity-pane.tsx` (new): timeline, mini-diff, notice, steering box,
  pause/resume/stop controls. A new shared tool-one-liner component extracted from
  `chat-pane.tsx`; `card-drawer.tsx` wires the tab.
- `src/app/lib/session-store.ts`: `steerRun`/`pauseRun`/`stopRun` actions.
- `src/board/schema.ts`: `paused` on `runSchema`.
- `src/server/services/runs.ts`: the three service paths, the shared resume helper refactor of
  `answerRun`, intent handling in `finishRun`, the reconcile guard.
- `src/worker/routes/run.ts`: three procedures; regenerated route index.
- `.knowledge/architecture/board-storage.md`, `.knowledge/architecture/api.md`: field + routes.
- Untouched: `src/sessions/` (runner, kinds, prompts: `steeringPrompt` is reused as-is),
  the MCP layer, gate/board/proposals services, board watcher/store, worktrees module,
  `chat-pane.tsx` behavior.

## Acceptance criteria

- [ ] The Activity tab on a story with a live run renders the stream: assistant narration,
  collapsed expandable tool one-liners, and `Edit`/`Write` calls as inline mini-diffs showing
  the file path with removed and added lines styled; the timeline autoscrolls and shows a
  working indicator while the process runs.
- [ ] The tab binds to the open run entry's session, falls back to the latest closed entry, and
  shows an empty state when the story has no runs; the chat tab's rendering is unchanged.
- [ ] Steering a running story kills the process group and resumes the same session id with a
  prompt stating the interruption plus the message; the card stays Running, the same entry `n`
  stays open, usage accumulates across segments, and the new segment streams into the same
  timeline.
- [ ] Pause kills the process and writes `paused: true` on the open entry with no outcome; the
  card stays Running, the pane shows the paused state, and Resume (a bare steer) clears
  `paused` and continues the run with the interruption notice.
- [ ] A paused story survives an orchestrator restart: reconciliation leaves it Running with the
  entry paused and Resume still works, while a crashed non-paused running story still parks
  Blocked.
- [ ] Stop closes the open entry `outcome: blocked` with `error: "stopped by the user"` and
  parks the card Blocked: on a running story it kills the process; on a paused or needs-input
  story it closes the entry directly and a pending question stays on the entry as record.
- [ ] Races resolve by evidence: a run that finishes cleanly on a question-free entry before a
  pause/stop kill lands in Review; an `ask_user` that lands during a steer or pause wins (the
  card reads Needs input and the steer rejects on the re-check); a stop that lands in the
  `ask_user` teardown window still parks the card Blocked with the question kept as record.
- [ ] `run.steer` and `run.pause` reject stories that are not `running`, `run.stop` rejects
  stories that are neither `running` nor `needs-input`, and a teardown that outlives the
  bounded wait rejects `RUN_ACTIVE`, the `run.answer` semantics.
- [ ] Editing the brief during a live run shows the Activity tab's notice (snapshot-hash
  mismatch) and the run's contract is unchanged until the next attempt.
- [ ] `pnpm check` passes.

## Out of scope

- The Running card's one-line live activity summary (board.md §Card anatomy): a board-surface
  slice, deferred with 002-08's card-action retrofit.
- Timeline replay: items accumulate from WS events received while the page is connected, the
  same limitation the chat pane ships with; no transcript backfill.
- Queue integration, the rate-limit auto-pause, and resume-with-the-window → 002-04 (user pause
  here is unrelated to the limit pause; 002-04 layers the queue on these same lifecycle paths).
- Compaction (the other planned kill-and-resume) → 002-05.
- Review surfaces (Diff tab, History tab) → 002-06/07.
- Steering chat kinds: already live through `session.message`.
- Notifications for pause/stop/steer events → v2.

## Open questions

None open; pause persistence on the run entry, stop's Blocked exit, and the result-wins race
rule are settled in Approach.
