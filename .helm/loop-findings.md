# First-dogfood-loop findings (002-01)

Defects and tunings surfaced while running Helm's own loop on story 002-01, the first loop whose
refinement ran through Helm itself. To triage into stories once the cost analysis is complete.

## Gate

- **Mid-flight brief edit destroys the whole gate attempt, silently.** `gate.ts:198-204`: when a
  brief edit lands while an adversary pass is in flight, the finished pass read stale text, so its
  verdict is discarded (correct) but the code calls `abort(attempt)`, dropping every round, the
  `overrides` register, and `pendingFixes`. Recovery is a full manual refining -> ready re-drive.
  Two problems: (1) it should re-queue a fresh round against the new brief (`enqueueRound`), not
  abandon the attempt; (2) the abort is silent (bare `abort`, no `logError`), same as the
  status-changed abort at `gate.ts:184`, so it vanishes from the UI with no diagnostic. Triggered
  by resolving a proposal while a round is landing. Origin: 001-06.

## Cost / model tuning

The loop cost $122 (modeled); the gate was ~$86 of it (adversary passes $52.54 + ~$34 of the
$43.62 refine chat, which spent 78% of its output and 84% of its cache-reads answering 12 gate
rounds, not building the brief). Cost scales with round count, so the round count is the lever.

- **Do NOT blind-swap `adversary` fable -> sonnet.** Empirically tested: re-ran Sonnet/high as the
  adversary on the exact pass 1 / 7 / 15 brief snapshots against the pre-merge repo (89a78ef),
  compared to Fable's real flags. Result: Fable and Sonnet find largely DISJOINT real flaws.
  Sonnet matched ~1.5 of Fable's 5 pass-1 flags and 0 of 4 pass-7 flags, missing every concrete
  lifecycle/permission blocker (allowlist-forbids-commit, gate-freshness, spawn-to-init bound,
  init-write races), the class whose omission makes a run fail. But on the final brief Fable
  passed clean, Sonnet found 3 real issues (api.md blast-radius omission, always-cold-vs-run
  context mismatch, unspiked duration_ms), all confirmed against the shipped code. So the two are
  different adversaries: Fable attacks mechanism/runtime, Sonnet attacks spec/doc completeness. A
  swap trades ~$36 for a gate blind to the exact blockers it exists to catch; a missed blocker
  costs a failed run + fix-up, erasing the saving.
- **Make `adversary` Opus/high (supersedes the two-lens idea).** Same empirical test extended to
  Opus/high on passes 1/7/15. Opus is not a different adversary like Sonnet; it is strictly
  stronger: 4 of Fable's 5 pass-1 flags and ~3 of 4 pass-7 flags (Fable's mechanism recall) PLUS
  Sonnet's completeness flags PLUS new real ones neither found (the `<repo>` path derivation, the
  generated-index-file trap, the un-spike-gated non-cone sparse-checkout pattern), all verified
  against shipped code. Killer result: Opus's single pass 7 raised 10 flags that Fable discovered
  across its rounds 7-14, roughly 3x the depth per pass. Since round count (not per-token price)
  drives gate cost, that compression ~cancels Opus's per-pass premium (~$12 vs Fable ~$3.50 in the
  harness; Opus rates assumed): adversary line stays ~neutral (~4-5 Opus passes ~= 15 Fable
  passes), and the real saving is the refine session shortening (84% of its cost is length-scaled
  cache-reads). Estimated gate ~$65-70 vs $86, with a materially better brief and fewer
  failure-prone rounds. Trivial code change: widen the `KindRow` model union to include `"opus"`.
  A two-lens Fable+Sonnet design is dominated: Opus gets both catch-profiles in one model.
- **Sonnet-only is a false economy for the adversary role.** Cheapest per pass (~$5) but misses
  the concrete lifecycle/permission blockers (gate-freshness, spawn-to-init bound, allowlist) AND
  needs the same round count, so no compression. Good for `review` (its current role), wrong for
  the gate.
- **Composes with warm-iteration.** Opus cuts breadth-discovery rounds; warming the iterative
  middle (one adversary session across the back-and-forth, single cold pass for sign-off) cuts the
  per-round cold re-read tax. Confirm the round compression by running one full Opus gate and
  counting actual rounds to convergence before committing. `refine`/`run` untouched.
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
