---
id: 001-01
status: ready
depends: []
gate: { passed: 2026-07-16T21:49:22Z, brief: 6a0ac2c4d1264bf5, overrides: [] }
---
# Session runner & kind registry

## Goal

The orchestrator spawns, streams, resumes, and kills a real `claude -p` session for any registered
session kind, with the kind fixing model, tool allowlist, system-prompt injection, and context
policy (`.knowledge/architecture/session-kinds.md`). Session events reach the UI live over WS.

## Approach

- New `src/sessions/` module, shaped like `src/board/`: pure session mechanics, no HTTP. A
  `src/server/` service wires it to the WS channels; `src/worker/` routes expose spawn/message.
- Spawn `claude -p` with `--output-format stream-json --verbose`, `--model` and the reasoning
  effort from the kind (the headless effort mechanism is spike-verified first,
  `.knowledge/architecture/claude-integration.md` §Invocation model), `--allowedTools` from the
  kind, `--append-system-prompt` for the kind's contract, cwd = the managed repo. Parse the
  NDJSON event stream (`system/init`, `assistant`, `user`, `rate_limit_event`, `result`) and
  forward typed events over a new WS channel in `src/shared/channels.ts`. Also pass
  `--include-partial-messages` (re-verify the flag against current docs) and forward its
  `stream_event` deltas, so the UI can render assistant output incrementally (001-03 consumes
  them).
- Capture the session id from `system/init`; later user messages resume with `--resume <id>`.
  Session ids persist in card frontmatter through the board store (epic/story files gain their
  `sessions` entry when a chat first attaches; shaping threads get theirs in 001-04, which first
  teaches the board module `shaping/`).
- Reseed on stale: a resume that exits 1 with `No conversation found` starts a fresh session
  seeded from the card, per the chat context policy. Steering: killing the process and resuming
  with a message that states the interruption.
- The kind registry is data: one table row per kind (model, effort, allowlist, prompt template
  reference, context policy), matching the registry in `session-kinds.md`. Only the chat kinds and the two
  cold kinds this milestone uses need entries wired to behavior.
- Reference mechanics: `spikes/stream-json/`; re-verify flags against current CLI docs first
  (`.knowledge/architecture/claude-integration.md`).

## Blast radius

New `src/sessions/` module (the bulk). Additions to `src/shared/channels.ts`,
`src/server/services/`, and `src/worker/routes/`. `src/board/` gains a frontmatter write for
`sessions` ids. No UI changes beyond whatever debug surface verification needs.

## Acceptance criteria

- [ ] Spawning a `shape`-kind session emits `system/init` carrying that kind's model, the events
      stream over WS as they arrive, and a tool call outside the kind's allowlist is denied
      (surfacing in `result.permission_denials`), never executed.
- [ ] A second message resumes the same session id, and the model demonstrates memory of the
      first turn.
- [ ] Killing a session mid-turn (SIGTERM) and resuming with a steering message continues with
      full memory.
- [ ] A resume against a deleted transcript fails loud and a fresh session starts, seeded from
      the card, with the new id persisted (exercised on a card-attached kind, `refine` on a
      story or `define` on an epic; shaping threads gain id persistence in 001-04).
- [ ] Two kinds spawn with visibly different registry rows (`shape` on Fable read-only,
      `research` on Sonnet) with no per-call configuration.

## Out of scope

- The MCP board tools and `--mcp-config` wiring (001-02).
- Any widget or chat UI (001-03).
- Run-kind compaction, the permission-prompt tool, and hooks (roadmap step 2).
- The queue: sessions here spawn directly on demand (001-06 adds the dispatcher).

## Open questions

None.
