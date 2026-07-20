# API: procedures, WS, and errors

The orchestrator exposes one oRPC router (HTTP, mounted at `/rpc`) and one WebSocket channel, both
served from the same process and origin as the SPA. `src/worker/routes/` holds one file per route
group; `stack generate` regenerates the barrel that wires them into the router.

## Procedures

| Procedure    | Behavior                                                                     |
| ------------ | ----------------------------------------------------------------------------- |
| `board.get`  | Returns the full `Board` snapshot (epics, stories, invalid files).            |
| `story.move` | Re-reads the story from disk (the snapshot only resolves id → path), validates the transition with `canTransition`, writes the new status, and returns `{ gating }`; the `board` channel's snapshot is the authority. Serialized through a per-repo write queue. A move into `ready` runs the ready gate: an incomplete brief is refused, a valid recorded `gate` verdict (frontmatter hash matches the brief body) writes `ready` for free, and a `refining` story otherwise enqueues a cold adversary pass on the dispatcher and returns `gating: true` with the card unchanged; the round then streams on the `gate` channel. A move into `running` is always refused: stories enter `running` through `run.start` alone. |
| `run.start` | Starts an implementation run on a Ready story: validates `ready → running` plus gate freshness (a stale verdict is refused), then dispatches through the serial run queue. With the slot free it converges the story's branch + worktree, spawns the run session under the story's permission preset with the brief as the per-segment system-prompt seed ([claude-integration](./claude-integration.md) §Context management), writes `status: running` with a new `runs` entry once `system/init` lands, and returns `{ sessionId }`; with the slot held it returns `{ queued: true }` at once and the run spawns when the slot frees (fresh starts in start-request order). The dequeue re-runs validation: a story that went stale while waiting, or a dequeue-time spawn failure, is skipped with a `"run-skipped"` board notice and the queue advances. An invalid `.helm/permissions.json` refuses the start (`INVALID_FILE`) before any spawn. The run streams on the `session` channel and the close path flips the card to Review or Blocked. A close that would land Review first rebases the story branch onto the repo's main branch, captures the configured check command's result to `<storyId>.check.json`, and writes the diff stat onto the closing entry ([board-storage](./board-storage.md) §Worktrees); a rebase conflict aborts the rebase (worktree left on the pre-rebase tip) and parks the card Blocked with an error naming the rebase. One run per story at a time (`RUN_ACTIVE` while one is live or queued); the run holds the queue slot from spawn to process close, so a paused or asking story holds none. |
| `run.permission` | Resolves a held permission prompt from a supervised (Guarded/Manual) run by id: approve returns the CLI its allow verdict with the exact recorded input, deny blocks the call with "denied from the board". The pending set travels on the `proposal` channel snapshot (`permissions`); an unknown id is `NOT_FOUND` (the set is in-memory, so a restart clears it with the run it belonged to). |
| `run.answer` | Answers a needs-input card: requires status `needs-input` and an open run entry carrying a `question` (validated up front on a fresh read). Enqueues at the queue's front (a continuation precedes waiting fresh starts) and tolerates its own story's segment: the asking process's teardown holds the slot until close, then the resume re-converges the worktree and resumes the entry's session with the answer under a freshly computed preset allowlist; on `system/init` one queued write flips to `running` and deletes the question. Returns the same `{ sessionId } \| { queued: true }` union as start; the finished resume closes through the normal run path with usage summed onto the same entry. |
| `run.steer` | Steers a running story: front-enqueues the resume, then kills the live process group (a paused run has none to kill); this enqueue-then-kill order means the freed slot cannot fall to a waiting fresh start. The resume waits for the killed segment's close (the bounded 60s teardown wait stays as the `RUN_ACTIVE` backstop) and resumes the open entry's session with a prompt stating the interruption plus the message. An absent message is the Resume button: the server substitutes "Continue the run." so a bare resume still carries the notice. The init write re-checks `running` with an open, question-free entry and deletes `paused` when set; an aborted write means the user's move (or a racing `ask_user`) won and rejects `ILLEGAL_TRANSITION`. Returns the same union as start; usage keeps summing onto the same entry. |
| `run.dequeue` | Cancels the story's queued run entry: the entry never runs and leaves the header occupancy. Kind-scoped to run entries (a queued gate round for the same story is out of reach), and it never touches a running slot (stop and pause own the live process). `NOT_FOUND` when the story has no queued run. |
| `run.pause` | Pauses a running story with a live process: kills the group and returns once the open entry's `paused: true` write landed ([board-storage](./board-storage.md) §Story file). The card stays `running` with no process; a story that is not `running` rejects `ILLEGAL_TRANSITION`, an already-paused one `NOT_FOUND`. A teardown failure or a racing `ask_user` wins over the pause (the entry closes blocked, or lands the question, instead). Resume is a bare `run.steer`. |
| `run.stop` | Stops a running or needs-input story: closes the open entry `outcome: blocked` with `error: "stopped by the user"` and parks the card Blocked. A live process is killed and closed through the run's close path (a clean completion observed before the kill still wins and lands in Review; a teardown failure also wins, over stop like every other intent). Stop is checked before the question segment-end, so it still parks the card over a racing `ask_user`; a paused or torn-down needs-input story closes with one direct write. A pending question stays on the entry as record. |
| `review.get` | The Review card's Diff-tab payload, `{ briefBody, check, files }`: the spawn-snapshot brief body (the live card body when the snapshot is gone), the check evidence from `<storyId>.check.json` (`null` when absent), and the per-file diff of the story branch against main (`git diff -M`) parsed into hunks with old/new line numbers, per-file additions/deletions, and added/modified/deleted/renamed statuses (an unparseable file degrades to a binary-style stub). Requires status `review` and an existing worktree, else `NOT_FOUND`. |
| `story.setPreset` | Writes the story's permission preset (`guarded`/`auto`/`manual`) through the write queue; legal at any status because the preset is read once at spawn, so a change during a live run takes effect on the next attempt. |
| `gate.resolveFlag` | User resolution of a contested gate flag: `accept` appends it to the brief's Open questions (which blocks the gate until resolved), `dismiss` records the override reason for the eventual `gate` block. Returns nothing; the `gate` channel snapshot is the authority. |
| `repo.get`   | Returns the managed repo's `{ path, name, mainBranch, branch }`; `branch` reads the checkout's current git branch. |
| `epic.create` | The `n` entry: mints the next epic ordinal, writes `<NNN>-<slug>/epic.md` from the title and rough goal, and returns `{ epicId }`; the caller spawns the define chat against it. |
| `session.spawn` | Spawns a fresh `claude` session of a chat kind; the always-cold kinds ride the serial dispatcher (`src/server/dispatcher.ts`, the adversary via the ready gate) and are refused here (`src/sessions/kinds.ts` registry fixes model, effort, allowlist, prompt, context policy). `refine` requires a `storyId` and `define` an `epicId`; the id persists in that card's frontmatter. A refine spawn requires the story in `backlog` or `refining` (else `ILLEGAL_TRANSITION`) and the attach write flips a `backlog` card to `refining`; every fresh refine turn (first spawn or reseed) carries the epic's conclusions and the card in its appended system prompt, never in the transcript. `shape` takes only the prompt (the rough goal): the spawn first writes `.helm/board/shaping/<slug>.md` (slug from the goal's opening words, deduped with a numeric suffix) seeded with the goal as the first agreed note, then attaches the session to it. Returns `{ sessionId }` once `system/init` announces it; the turn keeps streaming on the `session` channel, and the session stays busy until its `closed` frame. |
| `session.message` | Resumes the session with a user message; same return-at-init contract. A resume whose transcript is gone reseeds a card-attached session (fresh spawn seeded from the card, new id persisted and returned). A session killed mid-turn gets the steering preamble prepended. |
| `session.kill` | SIGTERMs the live process, ending the turn without a `result` event. Steering is kill, then `session.message`. |
| `proposal.resolve` | Resolves one item of a pending proposal by index: accept, edit (a full replacement payload), or reject with a reason. Accepting is the only write (through `src/board/` inside the write queue); the last item resolving with any edit or rejection resumes the session with the batched outcomes — edited payloads included — for a re-proposal (held until the turn ends if it is mid-turn). Returns nothing; the `proposal` channel snapshot is the authority. |
| `proposal.answer` | Answers a pending `ask_user` question and resumes the session with the answer. A shape question whose text quotes an open decision verbatim is that decision's ask_user surface: the answer first checks the item off and folds into the agreed notes. |
| `shaping.resolveDecision` | The checklist path of decision resolution: checks the matching open Decisions item off, appends `- <decision>: <answer>` to the agreed notes, and resumes the thread's shape session with the resolution (held until the turn ends if it is mid-turn). |

## WS protocol

Five channels live in `src/shared/channels.ts`. `board` carries two server messages:

- `snapshot` — the full `Board`. Sent on every (re)subscribe and rebroadcast on any change, with a
  trailing 100ms debounce. The client applies it wholesale (with a pending-move overlay, below), so
  a missed one is irrelevant: the next supersedes it. `board.get` and `onSubscribe` serve the same
  `watcher.snapshot()`, so RPC and WS snapshots agree by construction.
- `notice` — `{ kind: "illegal-transition" | "watch-error" | "run-skipped", message }`, for reasons
  a snapshot cannot carry (a toast). An illegal hand edit is still applied (files are the truth)
  and reported; a `run-skipped` notice is a queued run dropped at dequeue (stale story, or a
  spawn failure).

There are no per-entity deltas: every change rebroadcasts the whole board. Mutations never travel
over WS; a client calls a procedure (`story.move`) and observes the resulting snapshot.

`session` carries every live session's CLI stream, tagged so clients filter by session:

- `event`: `{ runId, kind, sessionId?, event }`, one per stream-json event as it arrives,
  including the `stream_event` partial-message deltas. `runId` identifies one process (one turn);
  `sessionId` is absent only before `system/init` announces it.
- `closed`: `{ runId, kind, sessionId?, exitCode, signal, stale }`, one per process exit. The
  turn is over (and the session resumable) only at this frame; `result` precedes it by the
  process's shutdown time. `stale: true` is the loud reseed signal.

`proposal` carries the pending set of board-tool proposals, `ask_user` questions, and held run
permissions:

- `snapshot`: `{ proposals, questions, research, permissions }`, the whole pending set. Sent on
  every (re)subscribe and rebroadcast on every change, like `board`; the set is small, so a missed
  frame is irrelevant. A board tool call records a proposal or question here, a supervised run's
  permission-prompt call a `permissions` entry; resolutions travel over RPC (`proposal.resolve`,
  `proposal.answer`, `run.permission`), never WS. Pending state is in-memory only and does not
  survive an orchestrator restart (a run's pending `ask_user` question lives in frontmatter
  instead, [board-storage](./board-storage.md) §Story file).

`gate` carries the active ready-gate attempts:

- `snapshot`: `{ attempts }`, one entry per story with an open attempt: phase
  (`queued | adversary | refine | review | exhausted`), the rounds with their flags (title, detail,
  status, counter-argument), and the accumulated override reasons. Sent on every (re)subscribe and
  on every change, so a late subscriber replays the current gate state. Attempts are in-memory only;
  the durable outcome is the story's `gate` frontmatter block. Flag resolutions travel over RPC
  (`gate.resolveFlag`).

`meter` carries the dispatcher queue and the rate-limit meter:

- `snapshot`: `{ queue, windows, tokens }` — the queue occupancy (`cap`, running and queued entries
  as `{ kind, storyId? }` metas in order), the latest rate-limit info per window type from every
  session's `rate_limit_event` (`status`, `resetsAt` in unix seconds), and the lower-bound token
  sums (`fiveHour` since the window start, `week` trailing 7 days). Sent on every (re)subscribe
  and on every queue or meter change, with a trailing 100ms debounce. State is in-memory only;
  a restart clears it. Display only: `run.dequeue` travels over RPC.

Optimistic moves carry a **pending-move overlay** on the client: `moveStory` records `id → target`
and every incoming snapshot is applied with pending statuses overlaid, so a snapshot the watcher
built before the write (it trails disk by the ~250ms `awaitWriteFinish` window) cannot bounce the
dragged card. An entry clears when a snapshot confirms the target or when its RPC rejects.

## Errors

One scheme, defined at the API boundary and never duplicated: every failure is an `ApiError`
(`@fcalell/plugin-api/error`, an `ORPCError` alias) with an `UPPER_SNAKE` code. The UI shows the
error's `message` verbatim; a code the UI doesn't special-case still renders as that message.

Registry:

| Code                 | Meaning                                       | `data`                  |
| -------------------- | ---------------------------------------------- | ------------------------ |
| `NOT_FOUND`          | Unknown story/epic/session id, or the story file vanished before the write (ENOENT on the fresh read). | none |
| `ILLEGAL_TRANSITION` | `canTransition` rejected the move (HTTP 409).  | `{ from, to, reason }`  |
| `INVALID_FILE`       | The story file on disk is malformed at write time — a hand edit broke it (HTTP 409). | none |
| `SPAWN_FAILED`       | The `claude` process exited before `system/init`, or a run spawn missed it within the init timeout. | none |
| `RUN_ACTIVE`         | Any run path on a story with a queued run entry, or `run.start` (fresh starts only) on one whose run process is still live (HTTP 409). | none |
| `RUN_FAILED`         | A run's worktree/branch convergence failed (git error, or the branch already carries `.helm/` changes). | none |
| `SESSION_BUSY`       | The session is mid-turn; kill it before steering (HTTP 409). | none |
| `SESSION_COLD`       | The kind's context policy is always-cold, so the session never resumes (HTTP 409). | none |
| `SESSION_STALE`      | The transcript is gone and the session has no card to reseed from (HTTP 410). | none |
| `PROPOSAL_RESOLVED`  | The proposal item is already resolved, or the question already answered (HTTP 409). | none |
| `FLAG_NOT_CONTESTED` | `gate.resolveFlag` hit a flag that is not awaiting the user (already fixed, dismissed, or accepted) (HTTP 409). | none |

Input validation failures surface as oRPC's built-in `BAD_REQUEST` before a handler runs.
Unexpected (non-`ApiError`) throws reach the client as `INTERNAL_SERVER_ERROR`; the UI shows a
generic message rather than the raw error. A new failure mode gets a new code in this table, never
a parallel error shape.
