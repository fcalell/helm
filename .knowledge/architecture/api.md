# API: procedures, WS, and errors

The orchestrator exposes one oRPC router (HTTP, mounted at `/rpc`) and one WebSocket channel, both
served from the same process and origin as the SPA. `src/worker/routes/` holds one file per route
group; `stack generate` regenerates the barrel that wires them into the router.

## Procedures

| Procedure    | Behavior                                                                     |
| ------------ | ----------------------------------------------------------------------------- |
| `board.get`  | Returns the full `Board` snapshot (epics, stories, invalid files).            |
| `story.move` | Validates a transition with `canTransition`, writes the new status, and returns the updated `Story`. |
| `repo.get`   | Returns the managed repo's `{ path, name, mainBranch, branch }`; `branch` reads the checkout's current git branch. |

## WS protocol

One channel, `board` (`src/shared/channels.ts`). On every (re)subscribe the server sends a full
board snapshot, then relays the watcher's `BoardEvent`s verbatim. A reconnect replaces the client's board state entirely, so a missed delta is irrelevant
by construction: the next snapshot supersedes it. Mutations never travel over WS; a client calls a
procedure (`story.move`) and observes the resulting `story-changed` event on the channel.

## Errors

One scheme, defined at the API boundary and never duplicated: every failure is an `ApiError`
(`@fcalell/plugin-api/error`, an `ORPCError` alias) with an `UPPER_SNAKE` code. The UI shows the
error's `message` verbatim; a code the UI doesn't special-case still renders as that message.

Registry:

| Code                 | Meaning                                       | `data`                  |
| -------------------- | ---------------------------------------------- | ------------------------ |
| `NOT_FOUND`          | Unknown story id.                              | none                    |
| `ILLEGAL_TRANSITION` | `canTransition` rejected the move (HTTP 409).  | `{ from, to, reason }`  |

Input validation failures surface as oRPC's built-in `BAD_REQUEST` before a handler runs.
Unexpected (non-`ApiError`) throws reach the client as `INTERNAL_SERVER_ERROR`; the UI shows a
generic message rather than the raw error. A new failure mode gets a new code in this table, never
a parallel error shape.
