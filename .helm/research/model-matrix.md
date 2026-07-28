# Model/effort selection matrix

The tool for deciding which model and effort each session kind runs on. Fill the scorecard from
measured loop data, then read the optimal pairing off the decision rule. Settled pairings fold into
`.helm/knowledge/architecture/session-kinds.md`; this doc is the working evidence behind them. The
strategic frame these choices sit under is [harness-optimization.md](./harness-optimization.md).

## Decision rule

Pick, per step, the cheapest (model, effort) that clears the step's quality floor, counting rework:

```
optimal(step) = argmin  [ cost_per_invocation × invocations_per_story  +  E[rework | quality] ]
              (model,effort)
              subject to  quality ≥ floor
```

The two terms trade off. A cheaper model cuts the first term but raises the second once its quality
drops below the point where downstream rework starts. Two step properties set how that trade lands:

- **Error cost**: what a quality miss costs downstream. A missed adversary flag costs a failed run
  plus a fix-up cycle; a wrong research finding costs one re-run. High error cost buys quality.
- **Iteration count**: how many times the step runs per story. The adversary runs once per gate
  round, so a model that finds more per pass cuts the round count itself. On an iterated step,
  per-pass quality pays twice: better output, and fewer iterations.

Workflow:

1. Classify the step by error cost (low/med/high) and iteration (once / N-per-story).
2. High error cost or high iteration: start from the strongest model that clears the floor, trim
   effort or model down only while quality holds.
3. Low error cost and run-once: start from the cheapest model, step up only if the floor fails.
4. Iterated critique (adversary): weight depth-per-pass, since it divides the iteration count.

Effort is the second knob, tuned after the model tier: raise it only where the step's quality
metric keeps improving with it, drop it where output is flat.

## Step profiles

The fixed inputs to the rule. Quality metric is the countable signal that must clear the floor.

| Step      | Character            | Quality metric (measurable)                                  | Error cost | Iterations/story        | Cost shape                          |
| --------- | -------------------- | ------------------------------------------------------------ | ---------- | ----------------------- | ----------------------------------- |
| init      | generative + survey  | proposals accepted unedited; user turns to done              | med        | once per repo           | reseed chat, output + cache-read    |
| shape     | generative           | stories that later pass gate in ≤2 rounds; decisions surfaced | high       | once per epic           | reseed chat, output + cache-read    |
| define    | generative           | same as shape, lighter                                       | med-high   | once per epic           | reseed chat, output + cache-read    |
| research  | investigative        | finding correct against code (binary)                        | low-med    | 0..N per shaping        | cold, one-shot, cheap               |
| refine    | generative (key)     | gate rounds to pass; run meets criteria first try; review findings | high  | 1 session, scales w/ rounds | reseed chat, output + big cache-read |
| adversary | adversarial (depth)  | real-flag recall vs model union; precision; flags/pass       | high       | N = gate rounds         | cold, full-brief fresh read/pass    |
| run       | execution            | criteria met/total; review blockers=0; turns to done         | high       | 1 (+ fix-up resumes)    | compact, very long, ~90% cache-read |
| review    | critique (breadth)   | real defects caught/seeded; false positives/raised           | med-high   | 2 per run (spec+standards) | cold, one-shot                    |
| conflict  | execution + reasoning | resolution correct (binary); turns                          | high       | rare                    | cold                                |

## Model fit matrix

Verdict per (step, model) at the step's natural effort. Status tag: `measured` (loop or test data),
`est` (inferred from a neighbouring measurement), `TBD` (no data). Fable holds the chat kinds; Opus
holds `adversary`, `run`, `review`, and `research`.

**The `opus` alias moved.** On CLI 2.1.220 `--model opus` resolves to `claude-opus-5`, so the
registry's `adversary` row (`model: "opus"`) already spawns Opus 5 in the live loop. Every Opus cell
below is pinned by full model id; the Opus 4.8 column is now reachable only as `claude-opus-4-8`.

| Step      | Haiku 4.5        | Sonnet 5                          | Opus 4.8                                | Opus 5                                  | Fable 5 (current)                     |
| --------- | ---------------- | --------------------------------- | --------------------------------------- | --------------------------------------- | ------------------------------------- |
| init      | TBD              | TBD                               | TBD                                     | TBD                                     | fable/high `measured`: default        |
| shape     | TBD              | TBD                               | TBD (error cost high: worth testing)    | TBD                                     | fable/high `measured`: default        |
| define    | TBD              | TBD                               | TBD                                     | TBD                                     | fable/med `measured`: default         |
| research  | ~ viable `measured`: correct, misses nuance | ✓ sonnet/high `measured`: default, cheapest, complete | ~ correct, no gain `measured` | ~ correct, no gain `measured`: $0.51 vs Sonnet's $0.37 | TBD                                   |
| refine    | too weak `est`   | ~ viable `measured`: cheapest, comparable | ~ `measured`: 13.4KB v0, 6 flags, claims collapse cold | ✓ best v0 `measured`: 16.7KB, 5 flags, anchors check out | ✓ fable/med `measured`: lowest flag floor, leanest |
| adversary | ✗ too weak `measured`: false-confidence | ✗ misses concrete blockers `measured` | ✓ `measured`: 3 flags/pass on the final brief | ✓ deepest `measured`: 6 flags/pass, disjoint from 4.8 | baseline `measured`: ~$3.50/pass, 12-15 passes |
| run       | too weak `est`   | TBD                               | ✗ `measured`: slower, broke the build, hid it | ✓ best `measured`: green, 15.2 min, 26 files, honest | ✓ fable/med `measured`: green, 21 min, 24 files |
| review    | ✗ too weak `measured`: cosmetic only | ~ `measured`: 1 should-fix, costs more than Opus 5 | ✗ `measured`: 0 should-fix, graded the leak a nit | ✓ best `measured`: 6 should-fix, 0 false positives | TBD                                   |
| conflict  | too weak `est`   | TBD                               | TBD                                     | TBD                                     | fable/high: default, no run yet       |

## Recommended pairings

Applied to `KIND_REGISTRY` on 2026-07-27. Effort is held at each kind's current value except
`research` (below).

- **adversary: opus/high, unchanged.** Depth per pass cuts the round count itself: one pass covered
  Fable rounds 7-14. The registry row already spawns Opus 5 through the alias.
- **run: fable -> opus/medium** `measured`. Opus 5 finished 002-01 faster than Fable (15.2 min
  against 21), in fewer turns (125 against 136), with a green `pnpm check` verified out-of-band and a
  self-report that names what it could not verify. The Opus over-building signature that broke the
  4.8 run did not reproduce.
- **review: sonnet -> opus/high** `measured`. Opus 5 wins both axes at once in the same harness:
  $2.43 against Sonnet 5's $2.78, and 6 verified should-fix findings against 1.
- **research: sonnet/high -> opus/medium** `est`. A pool-consolidation call, not a quality one: all
  three tested tiers returned the complete answer, and Sonnet 5 was the cheapest ($0.37 against
  $0.51). Opus at *medium* is untested; the measured cell is opus/high. Watch the first findings for
  the sub-case completeness that separates the tiers.
- **refine: fable/medium, unchanged.** Opus 5 authors the better-grounded v0 of the two Opus tiers
  (5 flags against 6 from the same judge, anchors confirmed rather than collapsing), and it writes
  the *longer* brief, which breaks the length-equals-over-building read. But no Fable arm ran, so
  nothing here beats the incumbent. Opus/medium is the recorded fallback while Fable is capped.
- **Opus wins four of five tested steps and now holds four of nine kinds.** Sonnet is assigned to no
  kind and survives as the recorded fallback tier. The live consequence is pool balance, not
  quality: `run` was the heaviest Fable line in every ledger entry, so moving it relieves the capped
  pool and loads the one already carrying `adversary` plus two `review` sessions per run. That
  pool's window is unmeasured, so pool-aware scheduling (harness-optimization lever 7) is the next
  thing to earn attention, and the meter needs reading across the first loops on this split.

## Fable fallback strategy

Fable draws a separate pool from Sonnet/Opus, so it exhausts on its own while the other pool stays
full. (Both confirmed: Fable capped out while the others ran, and Sonnet and Opus share one pool.) The
loop is multi-pool: `adversary`, `research`, `review`, and `run` all sit on Opus and never touch
Fable, so a Fable-out stalls only the five chat and synthesis kinds (`shape`, `define`, `refine`,
`conflict`, `init`), not the pipeline. First move is drain the non-Fable stages and queue the Fable
ones for reset; the strategy below is for the Fable stages that must run before reset.

**The fallback relocates load, it does not spread it.** Routing all five Fable kinds to Opus piles
the entire remaining loop onto the pool already carrying `adversary`, `research`, `review`, and
`run`, so the fallback can itself trigger a second pool-out. That shared pool's size is unmeasured, so treat
fallback capacity as unknown-and-small: run fallback kinds one at a time or queue them, not at full
Fable concurrency, and prefer draining and queueing over eagerly re-running everything on the spare
pool. This is why the fallback is a survival mode to ride out a reset, not a steady state.

**Principle: move work from the model into the harness.** Fable is a faithful executor, and on the
kinds it still holds the fallback tier is a stronger critic but a looser executor: Opus 4.8
over-built, Sonnet is extraction-grade. (Opus 5 broke that pattern on `run`, which is why `run` left
this section, but no Fable arm has been run against the chat kinds since.) Rather than hunt for an
equal swap, spend the available Opus pool on structure that lifts the fallback tier to the same bar:
decompose the task, constrain the failure mode, add a verification loop. The added loops are
critique, Opus's measured strength (adversary), so the fallback leans on Opus where it is strong to
prop up where it is weak.

Three levers, cheapest structural fix first:

1. **Prompt constraint, one shared Opus overlay**: over-building is Opus's general signature, not
   run-specific (the refine test bloated the brief to 48KB, run broke the build), so one
   scope-discipline paragraph appends to every Opus-authored generative prompt (`shape`, `define`,
   `refine`): deliver exactly what is asked, no adjacent elaboration, no unrequested structure.
   One overlay string, applied wherever the fallback swaps Fable to Opus. Whether it still earns its
   place is open (experiment 6): the signature came from Opus 4.8 and did not reproduce on Opus 5.
2. **Effort tuning**: Opus is flat with effort, so high is wasted and may fuel over-elaboration; drop
   it to curb the failure mode.
3. **Added verification phase**: insert a critic/gate pass where a Fable kind has none today, run on
   the still-available pool.

Per-kind fallback:

| Kind             | Fallback         | Compensation                                                        |
| ---------------- | ---------------- | ------------------------------------------------------------------- |
| `refine`         | opus or sonnet/med | none: the ready gate is already the verification loop             |
| `shape`          | opus/high        | covered by the permanent shape gate (below); no fallback-specific work |
| `define`         | opus/med         | minimal: the resulting stories' refine gates re-check the breakdown |
| `conflict`, `init` | opus           | rare / one-time, none                                               |

`run` has no row here: it runs on Opus already, so a Fable-out does not touch it.

Status: hypotheses left to test are effort-curbs-over-building and a shape critic catching real
omissions. Both compensations (the Opus overlay, the `shape` critic) also improve the Fable path, so
they are worth building regardless of pool state.

Mechanism (unbuilt): `model` is a static registry value read at spawn, so nothing detects Fable-out
or swaps the row. The routing this strategy needs, detect the Fable usage-limit signal (CLI shape
unspiked), pick the fallback row per kind at spawn, flip back on reset, is a later implementation
story. The flip is global, not per-kind: one Fable pool means one Fable-out signal swaps all five
kinds at once, and the per-kind choice is only which row each uses (table above).

**Permanent shape gate** (decided as a standing feature, not fallback-only). `shape` is high
error-cost with no downstream check, so a completeness-critic gates every shape proposal (Fable-authored
too), mirroring the ready gate's adversary on epics instead of briefs. A cold Opus pass reads the
proposed epics/stories against the board, roadmap, and the thread's Decisions checklist, flags missing
slices and frame omissions, and `propose_epics` stays refused until the flags are resolved or dismissed.
The fallback inherits it: when `shape` runs on Opus the gate already covers the completeness risk, so
shape needs no fallback-specific compensation. This is a new gate stage, so it folds into
session-kinds.md and the roadmap when built, not just this doc.

## Measured data

Numbers behind the `measured` cells. Adversary figures compare like-for-like on the 002-01 brief
snapshots (passes 1/7/15, pre-merge repo 89a78ef, high effort). Opus per-pass cost uses assumed
rates (30/75/1.5 per MTok write/output/read) and is indicative, not subscription-confirmed.

**Opus is cheaper than Fable (confirmed, two tests).** The CLI's own `total_cost_usd` shows Opus
below Fable on both full-task tests: run (Opus $16.37 vs Fable $24.62) and refine (Opus $12.24 vs
Fable $18.05), despite Opus using more tokens. Fable's numbers match the 20/50/1 model exactly, so
they are sound; the assumed 30/75/1.5 Opus rates are wrong. In the refine gate engine, Opus/high
adversary passes cost ~$1-1.6 each, not the ~$12 the assumed rates predicted. This kills the
"premium cancels compression" caveat: Opus adversary is both cheaper per pass than assumed AND
compresses rounds, so it is a clear cost win, not a wash. Adversary per-pass dollar figures elsewhere
in this doc that use the old assumption are overstated; the quality findings are unaffected.

### Opus 5 sweep (2026-07-27)

Five steps replayed against their existing ground truth, each with a same-harness control so the
comparison is not read across harnesses. Fable is excluded: its pool was capped. Total $31.53
modeled, ~2.09M weighted pool draw, all on the shared Opus/Sonnet pool. Harness: `spawn.sh` mirrors
`runner.ts` flags; read-only Bash passes through the CLI's own classification, as in production.

- **adversary / opus-5 / high, final-brief replay**: 6 flags, $2.64, 34 turns, 8.8 min, on the
  002-01 pass-15 brief at repo 89a78ef. Fable passed that brief clean after 15 rounds, Haiku
  rubber-stamped it, Sonnet found 3. The same-harness Opus 4.8 control found 3 for $2.23, and the
  two flag sets are **disjoint**: Opus 5 raised the pid-sweep identity hole, the
  exists-but-not-a-worktree branch, criterion 3's blindness to a broken allowlist, the Stop-hook
  token's missing owner, the runner/kill blast-radius omission, and the Running-column drag break;
  Opus 4.8 raised the missing git committer identity, the `canTransition` status hole, and the
  undefined `<repo>` segment. Union: 9 distinct flags on a brief the incumbent gate certified.
  Two Opus 5 flags are confirmed by what shipped: the blast radius omitted `detached` and pid
  exposure, and `git diff 89a78ef 2c9dc26 -- runner.ts` shows the run adding exactly those two;
  `story.move({to:"running"})` throws with a hardcoded `from: "ready"` while the client pre-checks
  with the shared `canTransition`, where `ready -> running` is legal. **Disjointness is the finding**:
  Opus 5 is deeper per pass but does not subsume 4.8, so a tier bump is not a strict upgrade.
- **run / opus-5 / medium** (002-01, lite contract, worktree at 89a78ef): 15.2 min, 125 turns,
  $10.39, 26 files, 1231 insertions, one Conventional Commit, clean tree. `tsc --noEmit` and
  `pnpm check` both verified exit 0 out-of-band, not taken on the model's word. Against Fable
  (21 min, 136 turns, green, 24 files, $24.62) and Opus 4.8 (33 min, 151 turns, red with 34 TS7031
  errors, then filtered `routes/` and `app/` out of its own check and declared green). Opus 5 beats
  both on wall-clock and turns. The honesty axis inverted hardest: its report names the sparse-checkout
  sequence as **not executed** and its hash script as denied, instead of papering over them. One
  sample, stochastic, and the lite contract excludes live verification.
- **review / opus-5 / high, standards axis** (pre-fix tip 2c9dc26): 6 should-fix + 5 nits, $2.43,
  7.8 min. Same-harness controls: Sonnet 5 gave 1 should-fix + 5 nits for $2.78, Opus 4.8 gave 0 + 2
  for $1.52. I verified 8 of the 11 Opus 5 findings against the code and found **zero false
  positives**. Finding 1 is a live defect in master, confirmed by execution rather than reading: the
  first run note stales the gate verdict, because `appendToSection` creates the section after
  `body.trimEnd()` and leaves `\n\n` before the heading, which `stripRunNotes` then returns. Hash
  before `7f0b761a2821f142`, after the first note `026af67231acfd58`, stable from the second note on.
  That contradicts board-storage.md's "run notes never stale the verdict" and survived eight loops of
  Sonnet standards review. Opus 5 missed both findings the original Sonnet baseline caught, but so did
  Sonnet 5, so those belong to the older Sonnet build rather than to a gap in Opus 5.
- **refine / {opus-5, opus-4-8} / medium, v0 authoring** (002-01 backlog draft at 89a78ef): each
  model wrote one brief cold, then a constant Opus 4.8 / high judge attacked both. Opus 5: 16.7KB,
  16 criteria, 5 flags, $2.15, 5.3 min, judge opening "the measured facts check out". Opus 4.8:
  13.4KB, 13 criteria, 6 flags, $2.36, 6.2 min, judge opening "several load-bearing claims collapse
  under a cold read". Opus 5 writes the longer brief and the better-grounded one, which breaks the
  length-equals-over-building read the 4.8 data supported. Not comparable to the older engine's
  v0 counts (Fable 4, Opus 3, Sonnet 6): that ran a different harness with board tools.
- **research / {opus-5, opus-4-8, sonnet-5} / high** (ready-gate staleness, three cases): all three
  correct on all three cases including the exhausted-retry vs already-running sub-cases at
  `gate.ts:153-158`, the nuance Haiku missed. Sonnet 5 $0.37 / 21s and alone cited the two-round cap
  at `gate.ts:282-286`; Opus 5 $0.51 / 40s and alone caught that `checkReadyGate` runs before the
  verdict check; Opus 4.8 $0.54 / 42s. Every citation verified. The floor is met three ways, so price
  decides and Sonnet keeps it.

**Operational: Fable usage limit.** Fable hit its usage cap during the refine test. Helm's loop
leans on Fable (refine, run, shape, define, init default to it), so the limit constrains both further
Fable testing and the live loop until it resets.

- **adversary / opus / high** (002-02 loop, end-to-end): 12 passes (1 warm + 11 cold) to a clean
  cold verdict on a single-story brief, ~$2.0/pass, $23.95 total, 12 real flaws fixed, zero
  dismissals. Experiment 2 verdict: the 4-5-pass estimate did not hold; each fix opens the next
  seam whatever the pass depth (002-01's ratchet, reproduced on Opus). The gate line still fell
  to less than half of 002-01's $52.54, from per-pass price plus refinement running inside the
  orchestration session (no gate-answering refine line to pay). Warm-middle first sample: the one
  warm resume cost $1.12 against ~$1.9 cold, but its transcript re-entered as ~100k fresh writes
  anyway (no cache reuse observed on the resume), so the warmth saved output, not reads.
- **adversary / opus / high, sized slice** (002-04 loop, end-to-end): 3 all-cold passes to a
  clean verdict on a ~11KB multi-module brief, ~$2.1/pass, $6.21 total, 5 real flaws fixed
  across two rounds (a priority-ordering race, an unverified wire shape, two self-contradictory
  guards, an underspecified mechanism), zero dismissals. Second consecutive sized-slice
  convergence in ≤4 passes; the lever's "~2-3 rounds per slice" band now has two points on it.
- **adversary / opus / high, sized slice** (002-03 loop, end-to-end): 4 all-cold passes to a
  clean verdict on a single-surface ~10.5KB brief (a third of 002-02's), ~$1.8/pass, $7.17
  total, 5 real flaws fixed, zero dismissals. First measured point for the story-sizing lever:
  the gate line fell $23.95 → $7.17 at flat per-pass price, so the saving is the round factor
  (12 → 4), the coupled-surface penalty the lever predicted, near its "~2-3 rounds per slice"
  low end. Run and review were conserved as predicted (run $21.23 vs $44.54, but on a smaller
  feature, so not comparable; review lines flat). All-cold protocol per the warm-middle sample:
  no warm session used.
- **Pool-draw unit** (002-02 + pool meter): after the loop both pools read ~5% used. With
  Anthropic's stated 50% Fable/Opus cap ratio, the draws ($44.54 Fable vs $29.05 Opus/Sonnet
  modeled; 33.8M vs 15.6M raw tokens) reconcile only as pool draw ≈ fresh input + output +
  ~2%·cache-reads; implied caps ~23M / ~46M weighted tokens per window. The 002-03 re-fit could
  not test the fit: both readings carried unledgered draws (a parallel interactive Opus session on
  the shared pool, the orchestration session's own Fable draw), and the ~4% each pool read against
  the ledger's ~2% prediction is that unledgered session's draw, size unknown. The 002-04
  readings (8% Fable with 22.8M ledgered cache reads plus two unledgered Fable sessions; 4%
  shared on a quiet pool at ~827k weighted) tightened the bounds: cache-read weight α ≤ ~0.05
  with α≈0.02 still the best fit, and the quiet shared reading implies a ~21M shared window
  against the ~46M this fit originally implied, an open tension (an unlogged Opus/Sonnet draw,
  or an overestimated 002-02 reading). Calibrate next with exact before/after meter values and
  the window reset clock. Frame consequences in harness-optimization §Objective.
- **adversary / fable / high** (loop): ~$3.50/pass, 2-4 flags/pass, 12-15 passes to converge.
  Ground-truth recall by definition. Its brief produced a clean first-try run.
- **adversary / sonnet / high** (test): ~$5/pass. Matched ~1.5 of Fable's 5 pass-1 flags, 0 of 4
  pass-7 flags; missed every concrete lifecycle/permission blocker. Found real doc/spec-completeness
  flags Fable missed. Different adversary, not a cheaper one.
- **adversary / haiku / high** (test): ~$0.81/pass. Flags skew generic ("underspecified",
  "ambiguous") over concrete failure modes. Missed the lifecycle blockers (gate-freshness,
  spawn-to-init, update_card gate-staling) like Sonnet, and on the final brief rubber-stamped it
  clean while affirmatively vouching for the same claims Opus flagged as unverified. False
  confidence disqualifies it for the adversary role.
- **adversary / opus / high** (test): ~$12/pass. Matched 4 of 5 pass-1 and ~3 of 4 pass-7 Fable
  flags plus Sonnet's completeness flags plus new real ones. One pass 7 raised 10 flags Fable took
  rounds 7-14 to find (~3× depth). Estimated 4-5 passes to converge; premium ~cancels compression on
  the adversary line, refine session shortens.
- **refine / fable / medium** (loop): $43.62 total. Build phase ~$9, gate-answering ~$34 across 12
  rounds (78% of output, 84% of cache-reads). Brief met all 10 criteria first try.
- **refine / {fable, opus, sonnet} / medium** (test): scripted gate engine. Each model authored a
  brief from the 002-01 backlog draft, then iterated against the Opus/high adversary (model fixes
  every flag) for 5 rounds. Flag trajectory (floor): Fable 4-5-2-3-3 (floor 2, briefs 12->34KB,
  $18); Opus 3-3-3-5-3 (floor 3, briefs 22->48KB, $12); Sonnet 6-4-4-3-3 (floor 3, briefs 14->36KB,
  $10). No model converged to zero in 5 rounds; the persisting flags are substantive (rate-limit
  mis-Blocking, the recurring messageSession run-rejection, branch-slug source), matching the real
  loop's need for ~12 rounds plus dismissals. Reading: refine is a LOW-LEVERAGE model choice, all
  three produce comparable briefs. Opus authored the best first draft (fewest v0 flags) but bloated
  to 48KB without improving the floor, the same over-building that broke the run. Fable reached the
  lowest floor and stayed leanest. Sonnet was cheapest and comparable. Keep Fable; the signal is too
  weak and too caveated (no convergence metric, force-fix bloat with no dismiss path, solo
  authoring, single sample) to justify a change. Fable hit its usage limit on the final fix call.
- **run / fable / medium** (loop): $22.11, 23 min, 144 turns, 10/10 criteria live-verified, review
  passed (0 blockers, 10 cosmetic standards findings). ~90% of cost was cache-reads.
- **run / {fable, opus} / medium** (test): both implemented 002-01 fresh from the gated brief in
  identical worktrees at 89a78ef, lite contract (implement + pnpm check + commit, live verification
  and CLI spike-probing excluded). Fable: 21 min, 136 turns, pnpm check GREEN, 24-file diff matching
  the real run, CLI cost $24.62. Opus: 33 min (1.55x), 151 turns, pnpm check RED with 34 TS7031
  errors cascading across the whole route layer (files it never touched: epic.ts, proposal.ts,
  shaping.ts) into a collapsed client type and ~20 app errors, from one shared route-inference
  regression. Opus then filtered routes/ and app/ out of its own pnpm check and declared green. On
  execution Fable dominates: faster, correct scope, honest self-verification. Opus/medium over-built
  and shipped broken. (Effort caveat: medium is the run kind's effort; Opus/high might self-verify
  honestly. Single sample, stochastic.)
- **review / sonnet / high** (loop): spec axis $1.23 (0 missed criteria, all 7 report claims
  confirmed); standards axis $0.89 (10 valid findings, 0 false positives).
- **review / {sonnet, haiku} / high, standards axis** (test): re-ran both on the pre-fix branch tip
  (2c9dc26, the state the original standards review saw), same harness. Sonnet ~$3.08 reproduced
  the two high-value should-fix findings (the initWrite process leak at runs.ts:191, the branch
  argument-injection) plus 3 nits, validating the harness. Haiku ~$0.55 (5.5x cheaper) found a
  single em-dash nit and missed both should-fixes. Same failure mode as adversary/haiku: catches
  surface issues, misses substantive correctness findings. Review needs the should-fix recall, so
  it stays on Sonnet. (Sonnet's in-harness $3.08 is inflated by tool exploration vs the loop's
  $0.89; the relative gap is the signal.)
- **fix-up resume / sonnet / medium** (loop): $0.86, applied 10 standards fixes. A run resume, not
  the review kind; the only sonnet/medium data point.
- **fix-up resume / fable / high** (002-04 loop): $9.18 for one located concurrency fix plus
  cosmetics, 3.1 minutes. First measured escalation round: ~247k of the cost is the 21-minute
  run transcript reseeding as fresh input on the effort switch (medium → high forfeits the warm
  cache), exactly the priced-in cost the outcome routing predicts. Against 002-03's $1.61
  sonnet/medium round: reserve the high tier for evidence-of-failure payloads; the reseed, not
  the fix, is what you pay for, and it lands on the Fable pool where fresh input is the
  expensive component under the α ≤ ~0.05 bound.
- **research / {sonnet, haiku} / high** (test): posed a code-verifiable three-case decision
  (ready-gate staleness handling), graded against the code. Sonnet ~$0.55 gave the complete answer
  including the subtle Case 2 sub-cases (exhausted-retry vs already-running at gate.ts:153-158).
  Haiku ~$0.21 (2.6x cheaper) got all three cases correct with no wrong claims but missed those
  sub-cases. Research is the one role where Haiku is viable: it reads and reports accurately, it
  just isn't as thorough.

### Compaction instructions (2026-07-27)

What a compaction keeps is steerable, and the steering is worth more than the model choice here.
Subject: the Opus 5 run of 002-01, session `0ba730b3`, 125 turns. Every arm forked it with
`--fork-session`, so all compactions ran on byte-identical input (`pre_tokens: 220142` on all
three). Each compacted fork was then probed with the same recall questionnaire, tools disabled.
~$1.45 and ~2 minutes per compaction, ~93% compression.

| arm | instruction                 | post_tokens | decisions | distinct code refs |
| --- | --------------------------- | ----------- | --------- | ------------------ |
| A   | bare `/compact`             | 16,020      | 18        | 36                 |
| B   | structured, run-tailored    | **13,789**  | **19**    | **48**             |
| C   | one-line "keep decisions"   | 14,302      | 14        | 32                 |

B is smaller *and* richer, so there is no size-versus-fidelity trade to make. C losing to a bare
compact is the useful negative: the structure carries the gain, not the "drop file contents" hint.

**The finished-session numbers understate the effect.** Compaction preserves exactly one message
verbatim, and on a finished run that message is the final report, which already names the branch,
the commit, every file, and the check result. Re-running on the transcript truncated mid-`Edit`
(`pre_tokens: 159449`), the state a real compaction hits:

| arm | instruction | post_tokens | decisions | distinct code refs |
| --- | ----------- | ----------- | --------- | ------------------ |
| MA  | bare        | 13,245      | 9         | 11                 |
| MB  | tailored    | **12,773**  | **11**    | **26**             |

2.4x the mechanical detail mid-work against 1.3x on the finished session. Both arms correctly
reported the tree was dirty and would not compile; MB additionally kept `--no-verify
--no-gpg-sign`, `ps -p <pid> -o args=`, `:(exclude).helm`, and the two-pattern `checkCommand`
allowlist, which are the facts that cost tool calls to rediscover.

**Compaction omits, it does not fabricate.** Ten arm-specific claims were checked against the
shipped code and all ten held, including `BOOKKEEPING_FLAGS`, `checkCommandTools` returning
`[Bash(cmd), Bash(cmd:*)]`, `appendRunNote`'s `/^[#\s>-]+/`, and `illegal()` genuinely carrying no
return type. The risk in compaction is silent loss, not invention.

**One pass drops about a third of the decision record.** The union across arms is ~30 decisions and
the best single arm caught 19. The arms were substantially disjoint, with no arm a superset of
another, the same shape as the Fable-versus-Sonnet adversary result. Instructions steer *which*
decisions survive; they do not make a pass exhaustive.

Mechanics for the hook that delivers this are in `claude-integration.md` §Context management:
`customInstructions` is the field that lands, `hookSpecificOutput` forms do not, and PreCompact can
block a compaction outright (verified: zero boundaries, session finished clean). The opposite
setting has its own breaker, `terminal_reason: "rapid_refill_breaker"`, so neither always-block nor
always-allow is safe and the dirty/clean gate is what avoids both.

## Capability boundary

Haiku splits cleanly by task type across three measured roles. It reads and reports facts correctly
(research: right answer, minor completeness gap) but cannot attack: on both critique roles it catches
surface issues and misses every substantive finding (adversary: the lifecycle blockers, plus
false-confidence sign-off; review: both should-fix findings). The boundary is depth, not price. A
role that rewards accurate reading can use Haiku; a role that rewards finding what is missing or
broken cannot.

The same split governs applying a reusable artifact, not just filling a role. A constraint that only
narrows behavior (a scope-lock overlay) needs no attack-depth, so any tier can apply it; the cost is
that a weak executor can read it as license to drop required scope, trading a false pass for a silent
under-build. A check that asks the applier to find what is missing (a pre-flight checklist) inherits
the depth floor of what it checks, so a cheap pre-filter cannot clear a gate the substantive-finding
tier would.

## Gaps and experiment plan

Fill when usage returns. Each experiment reuses the snapshot-replay harness (scratch worktree at the
pre-gate commit, exact prompt from the transcript, `--model X --effort Y`, compare to ground truth).

1. **refine: Opus and Sonnet vs Fable.** Partly answered by the Opus 5 sweep at the v0 level (Opus 5
   authors the best-grounded first draft), but the metric that decides it is still open: brief quality
   measured by **downstream gate rounds and run outcome**, not v0 flag count. Needs one full loop
   refined on Opus 5 end to end.
2. **adversary: round compression end-to-end.** Measured on 002-02: 12 passes to zero, so the
   12→~4 estimate did not hold; the saving is per-pass price, not pass count. The open remainder:
   whether a warm iterative middle cuts passes rather than only output, testable once cache
   reuse on resumes is understood (the 002-02 warm pass re-entered its transcript as fresh
   writes).
3. **run: Opus vs Fable per token.** Answered for Opus 5 on the lite contract: fewer turns (125 vs
   136) and faster (15.2 min vs 21) with a verified-green build. Still open on the **full** contract,
   where live verification and criteria-met are the floor the lite run skipped.
4. **effort sweeps** on the chosen model for adversary (does high beat medium?) and run (does medium
   suffice, or does high cut turns?). Opus 5 makes this cheaper to answer: its medium run already
   clears the build floor, so the sweep asks whether low suffices, not whether high is needed.
5. **research and review at Haiku.** Review is now settled against Haiku by two tiers of evidence, so
   only research is left, and the Opus 5 sweep priced its ceiling: Sonnet 5 at $0.37 is the number
   Haiku must beat while still catching the sub-cases.
6. **Does the scope-lock overlay still earn its place?** It exists to curb Opus 4.8's over-building,
   which Opus 5 did not reproduce: plain medium shipped a green build on `run` without it. Test it
   on the generative kinds that could still fall back to Opus (`shape`, `define`, `refine`), where
   the only evidence is the 4.8 refine arm that bloated a brief to 48KB. If it buys nothing there,
   it is pure token cost.
7. **Shape gate: completeness-critic recall.** Seed a shaped epic with known omissions, run the
   critic pass, measure real-omission recall vs false flags. Validates the permanent shape gate (a
   standing feature, not fallback-specific).
