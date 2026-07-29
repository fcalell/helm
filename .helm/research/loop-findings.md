# Dogfood loop findings

Defects and tunings surfaced while running Helm's own loop, to triage into stories. The 002-01
sections record the first loop whose refinement ran through Helm itself; the 004 section records
the first loop driven end to end through the orchestrator API.

## Gate

Both items shipped with story 003-08 (gate resilience): the strip trims trailing whitespace on
both exits, and the mid-flight edit re-queues a fresh round while the remaining aborts log. Kept
as the record of the defect shapes.

- **Mid-flight brief edit destroys the whole gate attempt, silently.** `gate.ts:198-204`: when a
  brief edit lands while an adversary pass is in flight, the finished pass read stale text, so its
  verdict is discarded (correct) but the code calls `abort(attempt)`, dropping every round, the
  `overrides` register, and `pendingFixes`. Recovery is a full manual refining -> ready re-drive.
  Two problems: (1) it should re-queue a fresh round against the new brief (`enqueueRound`), not
  abandon the attempt; (2) the abort is silent (bare `abort`, no `logError`), same as the
  status-changed abort at `gate.ts:184`, so it vanishes from the UI with no diagnostic. Triggered
  by resolving a proposal while a round is landing. Origin: 001-06.

- **The first run note stales the gate verdict, defeating the hash exclusion.** `hash.ts:24-32` plus
  `markdown.ts:165-179`: `appendToSection` builds the new section from `body.trimEnd()` and joins it
  as `…text` + `"\n\n## Run notes\n\n" + line + "\n"`, so creating the section leaves a two-newline
  tail before the heading. `stripRunNotes` cuts from the heading, returns that tail, and the hash
  moves. Executed on the shipped code: body hashes `7f0b761a2821f142`, hashes `026af67231acfd58`
  after the first `update_card` note, then stays stable for every later note. So every run's first
  note breaks `verdictValid`, and a follow-up `run.start` or a move back to `ready` refuses with
  "brief edited since the gate". This contradicts board-storage.md's rule that run notes never stale
  the verdict. Fix: normalize the trailing whitespace on both sides of the strip. Found by the Opus 5
  standards-review test (model-matrix §Opus 5 sweep); eight loops of Sonnet standards review missed
  it. Origin: 002-01.

## Cost / model tuning

The loop cost $122 (modeled); the gate was ~$86 of it (adversary passes $52.54 + ~$34 of the
$43.62 refine chat, which spent 78% of its output and 84% of its cache-reads answering 12 gate
rounds, not building the brief). Cost scales with round count, so the round count is the lever.

The model side is settled and applied: `adversary` runs Opus/high, and the evidence behind it is in
`model-matrix.md` (per-kind rationale in `.helm/knowledge/architecture/session-kinds.md` §Model per
kind). What stays open below is story sizing and gate mechanics, which no model choice fixes.

- **Warm-iteration is still open.** Opus cuts breadth-discovery rounds; warming the iterative
  middle (one adversary session across the back-and-forth, single cold pass for sign-off) would cut
  the per-round cold re-read tax on top. Confirm the round compression by running one full Opus
  gate and counting actual rounds to convergence before committing. `refine`/`run` untouched.
- **12 rounds because the story was an epic.** 33 flags collapsed into 6 hard sub-problems
  (lifecycle races, git convergence, checkCommand plumbing, .helm bar integrity, crash
  reconciliation, hash semantics), 5 of which recurred across 3-10 rounds each. One 28KB brief
  carrying six attack surfaces cannot pass until all six are airtight. Right-sizing stories at
  shaping time cuts rounds, which cuts both the adversary and refine lines.
- **The recurrence is progressive deepening, not repetition.** Each round the adversary attacks the
  freshly-edited text and every fix opens a new, narrower seam (checkCommand took 5 rounds:
  no-source, then exists, then not-in-prompt, then allowlist-mapping, then comma-splitting). A
  "don't re-raise fixed titles" digest buys little, since the flags are new each time, not repeats.
  What collapses the ratchet is depth-per-pass (Opus front-loads the deep facets) and warm-iteration
  (one context that remembers what it already probed). Design question, not a bug.
- **The flags were legitimate.** The run verified all 10 criteria live first try and standards
  review found only cosmetic issues. The gate earned its cost; the waste is story size and the
  cold re-read price at Fable rates, not phantom findings.

## 004 loop: gate non-convergence (2026-07-28)

Stories 004-01 and 004-02, driven end to end through the orchestrator API. 004-01 was a normal
loop: 6 gate rounds, one needs-input round trip, review approved. 004-02 did not converge: 21
adversary rounds across repeatedly re-requested attempts, ended only by a human scope cut at
round 17 (the brief hand-rewritten to drop the accreted wake/supersession machinery), after which
rounds 18-21 settled it. No per-session ledger exists for this loop (the driver restarted
mid-epic); the orchestrator meter read ~1.7M pool tokens in its final five-hour window, an
undercount. Triaged into epic 005. Findings:

- **The gate is blind across attempts.** Each attempt caps at two automatic rounds and waits
  (correct), but a re-request starts fresh: attempts live in memory only
  (`src/server/services/gate.ts:53`) and the `gate` frontmatter block records only a pass. Nothing
  counts cumulative rounds, so nothing tells the user "attempt nine, same flag theme" and the
  signal to stop re-requesting and re-shape arrives as human exhaustion. The scope cut that ended
  004-02 at round 17 was available at round 5.
- **The resumed refine transcript carries sunk-cost bias, and its replay cost compounds.** The
  refine session kept reintroducing the supersession design its own transcript had argued for,
  even after edit resolutions removed it; every fix round replays the whole growing transcript.
  What broke the loop was a fresh brief read with no chat history, a reseed performed by hand.
- **Every accepted fix re-buys a full cold pass.** By design (a fix that narrows scope faces the
  next cold reader), and the design earns it: the cross-section incoherence that dominated 004-02
  is invisible to a reviewer reading only a diff. 002-02's warm-middle measurement points the same
  way: the warm fix-verify pass cost $1.12 against a ~$2 cold read and saved only one round. Any
  delta-round design must keep a full cold pass as the sign-off.
- **Model tiering for late rounds rejected.** Rounds 18-20 raised small genuine flaws that were
  accepted; a weaker late-round adversary either misses those or pays for itself in spurious
  flags, each of which costs a full refine round trip. The savings are linear, the failure mode
  multiplicative. `model-matrix.md` keeps adversary at Opus/high.
- **The root cause was shaping, not the gate.** 004-02 bundled a design-heavy interaction model
  into one story; the gate refused to certify it, correctly, and the cost was the refusal being
  silent about why. Same conclusion as the 002-01 story-sizing finding above, now with a second
  data point.

## 005 refinement (2026-07-29)

Surfaced while refining epic 005's stories. The epic grew from three cards to five: the
escalation split out of the round record (they kept colliding inside one brief), and a harness
story split out of both, because the gate's own behavior turned out to be unverifiable without
spending the pool the epic exists to protect.

- **A malformed session event crashes the orchestrator.** `spawnTracked` broadcasts any event
  carrying a session id (`src/server/services/sessions.ts:308-317`); the hub validates on
  broadcast against `sessionWireEventSchema`, whose `sessionId` is `z.uuid()`
  (`src/sessions/events.ts:156-161`); the ZodError throws inside the readline `"line"` listener
  (`src/sessions/runner.ts:206-221`), and nothing in `src/` or `@fcalell/plugin-node` installs an
  `uncaughtException` handler. A CLI event with a non-uuid `session_id` takes the server down
  instead of failing the spawn (`SessionSpawnError` covers only a death *before* init). The
  `closed` broadcast has the same constraint. Found while deciding what a verification stub may
  emit; evidence in `spikes/harness-feasibility/README.md`.
- **A stub `claude` that dies after init reads as a clean gate pass.** `runRound` awaits
  `run.done` and, seeing no flags, calls `writePass` and moves the story to Ready
  (`gate.ts:237-241`, `:319-341`) whatever the exit code. Any harness that stands in for the CLI
  must have something watching exit codes, or a broken stub silently certifies a brief.
- **The gate's expensive branches are its unverifiable ones.** A replay-only stub never calls the
  board tools, so its round is always flagless and always passes: flagged rounds, contested
  flags, the concession path, exhausted attempts and any accumulating record can only be produced
  by spending real Opus tokens. Three stories' live criteria collapsed into "graded by reading"
  before this was named. Story 005-05 exists to close it.
- **Unmeasured assumptions cost rounds, exactly as the anchors rule predicts.** The harness brief
  ran 12 → 11 → 14 flags across three cold passes while its three load-bearing assumptions (the
  MCP client/server pairing, the scratch cwd, the shim's module semantics) sat in prose. A
  one-sitting spike settled all three, and two came back the opposite of the assumption: a
  rejected MCP tool call *resolves* with `isError: true` rather than throwing, and a symlinked
  `dist/client` keeps the SPA served from a scratch cwd, so no config swap is needed. Same
  conclusion as define-refine.md §Defining an epic's anchors rule, now with a cost attached.
