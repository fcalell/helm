# First-dogfood-loop findings (002-01)

Defects and tunings surfaced while running Helm's own loop on story 002-01, the first loop whose
refinement ran through Helm itself. To triage into stories once the cost analysis is complete.

## Gate

Both items triaged into story 003-08 (gate resilience); they stay here as the evidence until it
ships.

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
