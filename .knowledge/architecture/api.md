# API: procedures, WS, and errors

The orchestrator exposes one oRPC router (HTTP, mounted at `/rpc`) and one WebSocket channel, both
served from the same process and origin as the SPA. `src/worker/routes/` holds one file per route
group; `stack generate` regenerates the barrel that wires them into the router.

## Procedures

| Procedure    | Behavior                                                                     |
| ------------ | ----------------------------------------------------------------------------- |
| `board.get`  | Returns the full `Board` snapshot (epics, stories, invalid files).            |
| `story.move` | Re-reads the story from disk (the snapshot only resolves id → path), validates the transition with `canTransition`, writes the new status, and returns `{ gating }`; the `board` channel's snapshot is the authority. Serialized through a per-repo write queue. A move into `ready` runs the ready gate: an incomplete brief is refused, a valid recorded `gate` verdict (frontmatter hash matches the brief body) writes `ready` for free, and a `refining` story otherwise enqueues a cold adversary pass on the dispatcher and returns `gating: true` with the card unchanged; the round then streams on the `gate` channel. A move into `running` is always refused: stories enter `running` through `run.start` alone. |
| `run.start` | Starts an implementation run on a Ready story: validates `ready → running` plus gate freshness (a stale verdict is refused), converges the story's branch + worktree, spawns the run session under the story's permission preset with the brief as its prompt, and writes `status: running` with a new `runs` entry once `system/init` lands. An invalid `.helm/permissions.json` refuses the start (`INVALID_FILE`) before any spawn. Returns `{ sessionId }`; the run streams on the `session` channel and the close path flips the card to Review or Blocked. One run per story at a time (`RUN_ACTIVE` while one is live). |
| `run.permission` | Resolves a held permission prompt from a supervised (Guarded/Manual) run by id: approve returns the CLI its allow verdict with the exact recorded input, deny blocks the call with "denied from the board". The pending set travels on the `proposal` channel snapshot (`permissions`); an unknown id is `NOT_FOUND` (the set is in-memory, so a restart clears it with the run it belonged to). |
| `run.answer` | Answers a needs-input card: requires status `needs-input` and an open run entry carrying a `question`. Waits out the asking process's teardown (bounded at 60s, then `RUN_ACTIVE`), claims the story's single run slot, re-converges the worktree, and resumes the entry's session with the answer under a freshly computed preset allowlist; on `system/init` one queued write flips to `running` and deletes the question. Returns `{ sessionId }`; the finished resume closes through the normal run path with usage summed onto the same entry. |
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

Four channels live in `src/shared/channels.ts`. `board` carries two server messages:

- `snapshot` — the full `Board`. Sent on every (re)subscribe and rebroadcast on any change, with a
  trailing 100ms debounce. The client applies it wholesale (with a pending-move overlay, below), so
  a missed one is irrelevant: the next supersedes it. `board.get` and `onSubscribe` serve the same
  `watcher.snapshot()`, so RPC and WS snapshots agree by construction.
- `notice` — `{ kind: "illegal-transition" | "watch-error", message }`, for reasons a snapshot
  cannot carry (a toast). An illegal hand edit is still applied (files are the truth) and reported.

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
| `RUN_ACTIVE`         | `run.start` on a story whose run process is still live (HTTP 409). | none |
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
