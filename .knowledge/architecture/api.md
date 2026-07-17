# API: procedures, WS, and errors

The orchestrator exposes one oRPC router (HTTP, mounted at `/rpc`) and one WebSocket channel, both
served from the same process and origin as the SPA. `src/worker/routes/` holds one file per route
group; `stack generate` regenerates the barrel that wires them into the router.

## Procedures

| Procedure    | Behavior                                                                     |
| ------------ | ----------------------------------------------------------------------------- |
| `board.get`  | Returns the full `Board` snapshot (epics, stories, invalid files).            |
| `story.move` | Re-reads the story from disk (the snapshot only resolves id → path), validates the transition with `canTransition`, writes the new status, and returns nothing; the `board` channel's snapshot is the authority. Serialized through a per-repo write queue. |
| `repo.get`   | Returns the managed repo's `{ path, name, mainBranch, branch }`; `branch` reads the checkout's current git branch. |
| `session.spawn` | Spawns a fresh `claude` session of the given kind (`src/sessions/kinds.ts` registry fixes model, effort, allowlist, prompt, context policy). `refine` requires a `storyId` and `define` an `epicId`; the id persists in that card's frontmatter. Returns `{ sessionId }` once `system/init` announces it; the turn keeps streaming on the `session` channel, and the session stays busy until its `closed` frame. |
| `session.message` | Resumes the session with a user message; same return-at-init contract. A resume whose transcript is gone reseeds a card-attached session (fresh spawn seeded from the card, new id persisted and returned). A session killed mid-turn gets the steering preamble prepended. |
| `session.kill` | SIGTERMs the live process, ending the turn without a `result` event. Steering is kill, then `session.message`. |
| `proposal.resolve` | Resolves one item of a pending proposal by index: accept, edit (a full replacement payload), or reject with a reason. Accepting is the only write (through `src/board/` inside the write queue); the last item resolving with any edit or rejection resumes the session with the batched outcomes — edited payloads included — for a re-proposal (held until the turn ends if it is mid-turn). Returns nothing; the `proposal` channel snapshot is the authority. |
| `proposal.answer` | Answers a pending `ask_user` question and resumes the session with the answer. |

## WS protocol

Three channels live in `src/shared/channels.ts`. `board` carries two server messages:

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

`proposal` carries the pending set of board-tool proposals and `ask_user` questions:

- `snapshot`: `{ proposals, questions }`, the whole pending set. Sent on every (re)subscribe and
  rebroadcast on every change, like `board`; the set is small, so a missed frame is irrelevant. A
  board tool call records a proposal or question here; resolutions travel over RPC
  (`proposal.resolve`, `proposal.answer`), never WS. Pending state is in-memory only and does not
  survive an orchestrator restart.

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
| `SPAWN_FAILED`       | The `claude` process exited before `system/init`. | none |
| `SESSION_BUSY`       | The session is mid-turn; kill it before steering (HTTP 409). | none |
| `SESSION_COLD`       | The kind's context policy is always-cold, so the session never resumes (HTTP 409). | none |
| `SESSION_STALE`      | The transcript is gone and the session has no card to reseed from (HTTP 410). | none |
| `PROPOSAL_RESOLVED`  | The proposal item is already resolved, or the question already answered (HTTP 409). | none |
| `UNSUPPORTED_RESOLUTION` | The tool's accept path lands with a later stage (`raise_decision` 001-04, `flag_risk` 001-06) (HTTP 501). | none |

Input validation failures surface as oRPC's built-in `BAD_REQUEST` before a handler runs.
Unexpected (non-`ApiError`) throws reach the client as `INTERNAL_SERVER_ERROR`; the UI shows a
generic message rather than the raw error. A new failure mode gets a new code in this table, never
a parallel error shape.
