---
id: 001-06
status: ready
depends: [001-05]
gate: { passed: 2026-07-16T22:54:34Z, brief: a29fe80142b0c92c, overrides: [] }
---
# Ready gate: dispatcher & adversary review

## Goal

"Move to Ready" runs the cold adversary pass and enables only on a pass: critical findings arrive
as `flag_risk` widgets, the verdict persists in the story's `gate` frontmatter bound to a brief
hash, and any brief edit stales it (`.knowledge/product/features/define-refine.md` §Ready gate).
The story also builds the **serial dispatcher** every non-chat kind rides.

## Approach

- The dispatcher is a one-at-a-time queue in `src/server/`: non-chat sessions (`adversary` now,
  `research` in 001-07, runs later) enqueue and spawn in order; chat kinds keep bypassing it
  (`.knowledge/architecture/session-kinds.md`).
- Move-to-ready first checks completeness (all sections set, no unresolved open question) and the
  recorded verdict: an unchanged brief with a valid `gate` hash re-enters Ready for free.
  Otherwise it enqueues a cold `adversary` session (Fable, read-only + `flag_risk`) that reads
  the finished brief, with no chat history, plus the attempt's override register
  (already-dismissed flags with their reasons), which it is instructed not to re-raise; the card
  stays `refining` behind a **gating** badge.
- Findings route to the story's refine session first
  (`.knowledge/product/features/define-refine.md` §Ready gate): the orchestrator resumes it with
  the flags, and the session answers each with a fix (an `update_brief` proposal whose new
  `resolves` field names the flag, extending 001-02's payload schemas) or a contest
  (`contest_flag`, a new tool on the 001-02 MCP server, enabled for refine only while a gate
  round is open; its payload names the flag and carries the counter-argument). Only contested
  flags render as `flag_risk` widgets, carrying the session's counter-argument:
  accepting files an open question, dismissing records an override reason; dismissal is
  user-only. A flag left unanswered when the session's turn ends renders contested with no
  counter-argument, so a round never idles.
- A round ends when every flag is fixed or dismissed and the brief is complete. Dismissals alone
  leave the brief unchanged, so the verdict stands and the story enters Ready with the overrides
  recorded; any accepted fix staled the verdict, so the gate re-enqueues a fresh cold pass
  itself, capped at two automatic rounds; after the second it surfaces the round history and
  waits for the user. The `gate` block accumulates dismissals from every round; a re-raise that
  slips past the register takes the normal fix-or-contest path.
- A pass writes the `gate` block (timestamp, brief-body hash, dismissed flags with reasons,
  `.knowledge/architecture/board-storage.md` §Story file) and flips status to `ready` through the
  transition machine. A verdict landing after a mid-flight brief edit fails the hash check and is
  discarded; the flags are the adversary's whole output, no report file.
- Brief hashing lives in `src/board/` next to the frontmatter writer so hand edits stale the
  verdict the same way chat edits do.
- The gate write goes through the same read-validate-write serialization the story routes use
  today (`src/worker/routes/story.ts`), so the dispatcher never bypasses the single-writer rule
  (`.knowledge/architecture/board-storage.md` §Mutation rules).

## Blast radius

New dispatcher service plus flag routing to the refine session and the auto re-enqueue in
`src/server/`; brief hashing and the gate rule on every transition into ready in `src/board/` (`transitions.ts`,
`markdown.ts`; the `gate` schema already sits in `schema.ts`); the `resolves` field on
`update_brief` and the new `contest_flag` tool in 001-02's MCP server machinery; adversary
prompt and kind wiring in `src/sessions/`; gate lifecycle events (story id, phase, round) with
replay-on-subscribe in `src/shared/channels.ts`, the state held in memory next to 001-02's
pending proposals; move-to-ready action, gating badge, `flag_risk` widgets, and the
round-history surface in `src/app/`.

## Acceptance criteria

- [ ] Move-to-ready on an incomplete brief (missing section or open question) is refused before
      any session spawns.
- [ ] Move-to-ready on a complete brief enqueues a cold adversary session and the card shows the
      gating badge while staying `refining`.
- [ ] A flag the refine session fixes (accepted `update_brief` carrying `resolves`) never
      renders as a flag widget, and resolving the last flag after an accepted fix re-enqueues a
      fresh cold pass with no user action; an all-dismissed round enters Ready with no re-run,
      overrides recorded.
- [ ] Accepting a contested `flag_risk` widget files it as an open question and the gate stays
      blocked until the brief resolves it; dismissing records the override reason in the
      eventual `gate` block.
- [ ] The third round never self-enqueues: the gate surfaces the round history and waits.
- [ ] A later round's adversary prompt carries the earlier rounds' dismissals, and the final
      `gate` block records overrides from every round.
- [ ] A flag the refine session leaves unanswered at turn end renders as a contested widget
      with no counter-argument.
- [ ] A pass writes `gate` (timestamp, hash, overrides) and the card lands in Ready.
- [ ] Any brief edit after the pass stales the verdict: the next move-to-ready runs a fresh
      adversary pass, while an untouched brief re-enters Ready with no session.
- [ ] A brief edited while the adversary runs discards the landing verdict on hash mismatch.
- [ ] Two gate requests queue: the second adversary session starts only after the first exits.

## Out of scope

- Research sessions on the dispatcher (001-07).
- Implementation runs, rate-limit pause, and queue occupancy UI (roadmap step 2).

## Open questions

None.
