---
id: 002-05
status: done
depends: [002-01]
branch: helm/002-05-run-compaction
gate: { passed: 2026-07-20T15:12:00.000Z, brief: da9c4e0b590b044d, overrides: [] }
sessions: {}
runs:
  - { n: 1, session: 2c1ab3b5-4c0b-4657-90b8-c63fa184d750, brief: da9c4e0b590b044d, started: 2026-07-20T15:12:26Z, outcome: review, grades: 9/9, tokens: 1197279, minutes: 36.9 }
---
# Run compaction

## Goal

A run that nears its context window survives it, and the mechanic is now measured instead of
designed on faith: headless `-p` auto-compacts mid-turn on CLI 2.1.215 (three auto compactions in
one probe turn, session id stable, clean result), so the orchestrator's provisional
kill-summarize-reseed handoff is retired. The story hardens the native mechanism: auto-compact
forced on for every run segment, the brief moved into every segment's system prompt so the
contract structurally survives summarization, the compact boundary surfaced on the activity
timeline, and `.knowledge/` rewritten from measurement
(`.knowledge/architecture/claude-integration.md` §Context management).

## Approach

**Measured facts (CLI 2.1.215, 2026-07-20).** The ground the design stands on, measured live
against subscription auth:

- Headless `-p` auto-compacts mid-turn. Under `CLAUDE_CODE_AUTO_COMPACT_WINDOW=45000`, a
  four-file read task compacted three times and finished `success` in one process. Each
  compaction emits a `system` event, verbatim (object fields trimmed):
  `{"type":"system","subtype":"compact_boundary","session_id":"…","compact_metadata":{"trigger":"auto","pre_tokens":66160,"post_tokens":15035,"cumulative_dropped_tokens":51125,"duration_ms":26071,"preserved_segment":{…},"preserved_messages":{…}}}`.
  The session id is stable across compactions, and a later `--resume` works with post-compact
  memory intact.
- `--settings` honors `autoCompactEnabled`: the same over-threshold task under
  `{"autoCompactEnabled": false}` emitted zero boundaries. Writing `true` in the run's per-spawn
  settings file therefore overrides a user-global disable (settings precedence: `--settings` >
  project > user).
- `--append-system-prompt` rides every spawn, resumes included (`src/sessions/runner.ts` already
  passes it unconditionally), and a resumed session reads it (probe: a marker appended on resume
  was acknowledged). A byte-identical seed across segments keeps the prompt-cache prefix stable.
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` shrinks the capacity auto-compact calculates against, so
  compaction is testable end to end without filling a real window. Spawned children inherit it
  through `sessionEnv()`; production hosts simply never set it.

**Force auto-compact on.** `runSettings()` (`src/server/services/runs.ts`) gains
`autoCompactEnabled: true` alongside the deny rules and Stop hook; fresh starts and resumes
already share it. No orchestrator watching, no threshold constant: the CLI owns the trigger. An
overflow the CLI cannot compact past (docs: one oversized file or tool result can stop
auto-compact; the API error is "Prompt is too long") surfaces as an error result, and the
existing close path parks the card Blocked with the error. No new code on that edge.

**The brief rides every segment's system prompt.** `runPrompt` embeds the brief in the first user
message only; compaction may summarize it away, and answer/steer segments never restate it.
Moving the contract:

- `src/sessions/prompts.ts`: `runPrompt(checkCommand, preset)` drops the brief embed and keeps
  the kickoff line (now pointing at "the story brief in your system instructions") plus the
  check-command sentence; a new `runBriefSeed(briefBody)` wraps the body in `<brief>` fences for
  the system prompt (the `refineSeedPrompt` shape). `RUN_PROMPT` in `src/sessions/kinds.ts`
  updates its "brief in your prompt" wording to match.
- `src/server/services/sessions.ts`: `spawnRunSession` accepts `seedSystemPrompt` and forwards it
  to `spawnTracked` on every segment, fresh and resume (the runner appends it whenever set;
  today's chat-kind gating lives in `runTurn`, not the runner).
- `src/server/services/runs.ts`: `start()` writes the spawn snapshot verbatim to
  `<storyId>.brief.md` in `worktreesDir` (the settings-file pattern, overwritten by the next
  fresh start) and seeds the spawn from that same string; `resume()` reads the file and passes
  its exact content, so every segment's system prompt is byte-identical and the mid-run hand-edit
  rule holds (the card body is never re-read for the seed). Missing file (host moved, directory
  cleaned): fall back to the current card body when `briefHash(body)` equals the open entry's
  `brief` hash, the snapshot rule's own equality; on a hash mismatch resume without the seed and
  log, since the transcript still carries the brief and only the structural guarantee degrades.
  Never block a resume on the file.

**Surface the boundary.** `src/sessions/events.ts` gains `parseCompactBoundary` (the
tolerant-boundary pattern): `{ trigger, preTokens, postTokens }` from the frame above, undefined
for everything else. The session channel already broadcasts every event, so no server change
beyond the parser. `src/app/lib/session-store.ts` ingests the event as a new chat item
`{ type: "compact", trigger, preTokens, postTokens }`, and `activity-pane.tsx` renders it as a
muted marker row ("context compacted · 66k → 15k", the meter's compact k-format). The chat pane
ignores the new item type (chat kinds stay effectively uncompacted; the run timeline is where it
lands).

**Docs.** `claude-integration.md` §Context management: rewritten from measurement; runs compact
natively mid-turn, the orchestrator forces `autoCompactEnabled` per spawn, the brief rides every
segment's system prompt from the spawn snapshot, the boundary frame recorded verbatim, overflow
parks Blocked. `session-kinds.md` §Context policies: the compact-under-pressure bullet drops the
orchestrator-driven summary for the native mechanism. `runs.md` §The brief is snapshotted at
spawn: "compaction reseeds from the snapshot" becomes the system-prompt carriage. No
board-storage change: frontmatter is untouched (same session id, same entry).

## Blast radius

- `src/server/services/runs.ts`: `autoCompactEnabled` in `runSettings`, the `<storyId>.brief.md`
  snapshot write/read, the per-segment seed.
- `src/sessions/prompts.ts`: `runPrompt` reshape, `runBriefSeed`; `src/sessions/kinds.ts`:
  `RUN_PROMPT` wording.
- `src/server/services/sessions.ts`: `seedSystemPrompt` through `spawnRunSession`.
- `src/sessions/events.ts`: `parseCompactBoundary`.
- `src/app/lib/session-store.ts`: the `compact` chat item;
  `src/app/components/activity-pane.tsx`: the marker row.
- `.knowledge/architecture/claude-integration.md`, `.knowledge/architecture/session-kinds.md`,
  `.knowledge/product/features/runs.md`: the measured rewrite.
- Untouched: the dispatcher and queue, the meter, the board watcher/store and schema, the MCP
  layer, worktrees, `reconcile`, every non-run session kind's spawn path.

## Acceptance criteria

- [ ] Every run segment's settings file (fresh start and resume) carries
  `autoCompactEnabled: true` next to the deny rules and Stop hook.
- [ ] With `CLAUDE_CODE_AUTO_COMPACT_WINDOW` set small in the orchestrator's environment, a
  scratch-repo run that reads beyond the window emits `compact_boundary` events, keeps running,
  and finishes with outcome `review` on a single run entry whose session id never changed.
- [ ] A fresh start writes the brief body verbatim to `<storyId>.brief.md` under `worktreesDir`
  and passes it as the segment's system-prompt seed; an answer or steer resume passes
  byte-identical seed content read from that file, and a mid-run card body edit changes neither.
- [ ] A resume with the snapshot file missing falls back to the card body only when
  `briefHash(body)` matches the open entry's `brief` hash; on a mismatch it spawns without the
  seed and logs, and it never rejects for the missing file alone.
- [ ] `runPrompt`'s user message no longer embeds the brief body and keeps the per-preset
  check-command sentence; the brief reaches the model through `--append-system-prompt` (visible
  in the spawned process's args or the settings-driven probe).
- [ ] `parseCompactBoundary` parses the measured frame to
  `{ trigger, preTokens, postTokens }`, ignores unknown fields, and returns undefined for other
  system events.
- [ ] The activity timeline renders a compact marker row (trigger plus pre/post tokens in
  k-format) at the boundary's position in the stream; the chat pane renders nothing for it.
- [ ] The three knowledge docs state the native mechanism with the verbatim boundary frame in
  `claude-integration.md`, and no doc still describes the orchestrator-driven handoff.
- [ ] `pnpm check` passes.

## Out of scope

- The orchestrator-driven kill-summarize-reseed handoff: retired by measurement, native
  auto-compact dominates (mid-turn, same session, no orchestrator threshold).
- Persisting compaction history (run-entry counters, frontmatter fields) and the v2
  standing-context meter.
- Queue auto-pause and rate-limit interactions (002-04's v2 scope); compact-instructions
  curation (roadmap Later, Rules & knowledge library).
- Snapshot-file cleanup at approve/discard: 002-07 owns end-of-story cleanup.

## Open questions

None open; the mechanism, the seed carriage, and the fallback order are settled in Approach from
the measured probes.
