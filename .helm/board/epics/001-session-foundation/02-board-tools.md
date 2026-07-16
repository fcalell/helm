---
id: 001-02
status: ready
depends: [001-01]
gate: { passed: 2026-07-16T21:53:36Z, brief: c9535b529cf92317, overrides: [] }
---
# Board tools: in-process MCP server & proposals

## Goal

Chat sessions receive the orchestrator's own MCP server, and every board tool call becomes a
recorded **proposal** the user resolves: accepting one is the single orchestrator write, an edit
or rejection resumes the session with the reason. Claude never writes board files from chat
(`.knowledge/architecture/claude-integration.md` §Board tools).

## Approach

- Official MCP SDK server, streamable HTTP on localhost, mounted on the orchestrator's Hono app
  (fresh server + transport per request, the spike-verified stateless pattern); sessions get it
  via `--mcp-config` plus `--strict-mcp-config` so the user's global servers stay out. The stack
  exposes no raw-route mount today (services get `{ log, ws }`; worker routes are oRPC), so this
  lands a raw-mount extension in the sibling `../stack` repo — the stack is improved, never
  worked around; the spike's standalone `node:http` server is reference mechanics, not the shape.
- Caller identity rides the transport: each spawn's `--mcp-config` names a per-spawn URL
  (`/mcp/<spawn-token>`, an orchestrator-minted handle bound to its session record once
  `system/init` reports the id), so every tool call is bound server-side to its session and
  card; tool payloads never carry ids.
- Tools vary by kind, per the registry: `propose_epics` / `propose_stories` / `raise_decision`
  (shape), `propose_stories` (define), `update_brief` / `resolve_question` (refine), `flag_risk`
  (adversary), `ask_user` (every kind). `update_card` and `propose_scaffold` wait for their
  stages.
- A tool call validates its payload, records a pending proposal (in-memory on the orchestrator,
  broadcast over WS), and returns a "recorded" result so the session can continue or end its
  turn. `ask_user` records the question and instructs the model to end its turn.
- Resolution endpoints in `src/worker/routes/`, per-item: one call carries each item's outcome
  (accept / edit / reject); accepted items land in one orchestrator write through `src/board/`
  (new epic folder, story file, brief section, checklist item), and the edit/reject texts batch
  into a single resume message; answer resumes with the answer. Epic ordinals mint one above the
  highest ever used — the live tree plus git history (`--diff-filter=A` over `epics/`) — so a
  deleted epic's ordinal is never reused, even the maximum's
  (`.knowledge/architecture/board-storage.md` §Layout retires ordinals permanently).
- Two tools ship recorded-only, their accept paths deferred with their stages: `raise_decision`'s
  accept write (the shaping thread's Decisions checklist) waits for 001-04, which first teaches
  the board module `shaping/`; `flag_risk`'s resolution semantics (accept files an open
  question, dismiss records an override — the adversary is always cold, never resumed) land with
  001-06. Both still record, validate, and broadcast here.
- Proposal payload schemas live next to the tools and match what the board store writes, so an
  accepted proposal lands as a valid file the watcher immediately reloads.

## Blast radius

New MCP server module under `src/server/` (the bulk) and proposal-resolution routes in
`src/worker/routes/`. Additions to `src/shared/channels.ts` (proposal and question events) and
`src/board/` (creation writes: epic folder, story file, brief-section update). `src/sessions/`
gains the `--mcp-config` wiring. A raw-mount extension in the sibling `../stack` repo, under its
own rules. No UI.

## Acceptance criteria

- [ ] A `shape` session's `system/init` lists exactly one MCP server, the orchestrator's, and the
      kind's tools.
- [ ] A `propose_epics` call produces a pending proposal visible over WS and writes nothing to
      `.helm/board/`.
- [ ] Accepting that proposal writes the epic folder through the board store and the UI reloads
      it live via the watcher.
- [ ] Rejecting a proposal with a reason resumes the session, and the next assistant turn
      addresses the reason.
- [ ] `ask_user` ends the session's turn with a pending question; answering resumes the session
      with the answer.
- [ ] A tool payload that fails validation returns an error result to the model instead of
      recording a proposal.

## Out of scope

- Widget rendering and any drawer UI (001-03).
- The permission-prompt tool and `update_card` (roadmap step 2), `propose_scaffold` (init, v2).
- Proposal persistence across orchestrator restarts: a pending proposal dies with the process;
  the chat resumes and re-proposes.

## Open questions

None.
