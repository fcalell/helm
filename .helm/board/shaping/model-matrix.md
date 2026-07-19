# Model/effort selection matrix

The tool for deciding which model and effort each session kind runs on. Fill the scorecard from
measured loop data, then read the optimal pairing off the decision rule. Settled pairings fold into
`.knowledge/architecture/session-kinds.md`; this doc is the working evidence behind them. The
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
`est` (inferred from a neighbouring measurement), `TBD` (no data). Fable holds the loop defaults.

| Step      | Haiku 4.5        | Sonnet 5                          | Opus 4.8                                | Fable 5 (current)                     |
| --------- | ---------------- | --------------------------------- | --------------------------------------- | ------------------------------------- |
| init      | TBD              | TBD                               | TBD                                     | fable/high `measured`: default        |
| shape     | TBD              | TBD                               | TBD (error cost high: worth testing)    | fable/high `measured`: default        |
| define    | TBD              | TBD                               | TBD                                     | fable/med `measured`: default         |
| research  | ~ viable `measured`: correct, misses nuance | sonnet/high `measured`: default, catches sub-cases | overkill `est` | TBD                                   |
| refine    | too weak `est`   | ~ viable `measured`: cheapest, comparable | ~ over-builds `measured`: best v0, bloats to 48KB | ✓ fable/med `measured`: lowest flag floor, leanest |
| adversary | ✗ too weak `measured`: false-confidence | ✗ misses concrete blockers `measured` | ✓ best value `measured`: ~10 flags/pass, ~3× round compression | baseline `measured`: ~$3.50/pass, 12-15 passes |
| run       | too weak `est`   | TBD                               | ✗ `measured`: slower, broke the build, hid it | ✓ fable/med `measured`: green, 21 min, 24 files |
| review    | ✗ too weak `measured`: cosmetic only | ✓ sonnet/high `measured`: catches the should-fix findings | overkill `est`     | TBD                                   |
| conflict  | too weak `est`   | TBD                               | TBD                                     | fable/high: default, no run yet       |

## Recommended pairings

What the measured cells support. Effort is held at each kind's current value (tuned later).

- **adversary: fable -> opus/high.** The one high-leverage, high-confidence change. Opus has Fable's
  mechanism recall and Sonnet's completeness recall in one pass, ~3x the depth (one pass covered
  Fable rounds 7-14), and costs less than Fable per the CLI. Deeper, cheaper, fewer rounds.
- **review: keep sonnet/high.** Catches the should-fix findings; Haiku misses them, Opus is overkill.
- **run: keep fable/medium.** Opus/medium was slower, broke the build, and hid its own errors.
- **refine: keep fable/medium.** Low-leverage: all three produce comparable briefs. Opus over-builds
  (48KB, no floor gain), Sonnet is cheapest but not better. No reason to change.
- **research: consider haiku/high.** Viable and cheapest for this low-stakes read role; Sonnet is the
  safe default when a research finding feeds a high-stakes decision.
- **No single best model.** Opus wins adversary but loses run; Fable wins run and holds refine;
  Sonnet holds review; Haiku only fits research. The per-step split is the result, not a fallback.

## Fable fallback strategy

Fable draws a separate pool from Sonnet/Opus, so it exhausts on its own while the other pool stays
full. (Both confirmed: Fable capped out while the others ran, and Sonnet and Opus share one pool.) The
loop is multi-pool: `research`/`review` (Sonnet) and `adversary`
(Opus) never touch Fable, so a Fable-out stalls only the six synthesis/execution kinds (`shape`,
`define`, `refine`, `run`, `conflict`, `init`), not the pipeline. First move is drain the non-Fable
stages and queue the Fable ones for reset; the strategy below is for the Fable stages that must run
before reset.

**The fallback relocates load, it does not spread it.** Routing all six Fable kinds to Opus/Sonnet
piles the entire remaining loop onto the pool already carrying adversary, research, and review, so the
fallback can itself trigger a second pool-out. That shared pool's size is unmeasured, so treat
fallback capacity as unknown-and-small: run fallback kinds one at a time or queue them, not at full
Fable concurrency, and prefer draining and queueing over eagerly re-running everything on the spare
pool. This is why the fallback is a survival mode to ride out a reset, not a steady state.

**Principle: move work from the model into the harness.** Fable is a faithful executor that dominates
coding; the fallback tiers are stronger critics but worse executors (Opus over-builds, Sonnet is
extraction-grade). No swap equals Fable on the coding kinds. Instead spend the available Opus/Sonnet
pool on structure that lifts the fallback tier to the same bar: decompose the task, constrain the
failure mode, add a verification loop. The added loops are critique, Opus's measured strength
(adversary), so the fallback leans on Opus where it is strong to prop up where it is weak.

Three levers, cheapest structural fix first:

1. **Prompt constraint, one shared Opus overlay**: over-building is Opus's general signature, not
   run-specific (the refine test bloated the brief to 48KB, run broke the build), so one
   scope-discipline paragraph appends to every Opus-authored generative prompt (`shape`, `define`,
   `refine`, `run`): deliver exactly what is asked, no adjacent elaboration, no unrequested structure.
   One overlay string, applied wherever the fallback swaps Fable to Opus.
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
| `run`            | see A/B below    | the hard case                                                       |

`run` fallback default is **Path B, faithful executor**: sonnet/high executes the brief. A story
reaches `run` only after the gate (Opus adversary + refine) hardened its brief, so `run` under
fallback executes an Opus-hardened spec rather than synthesizing one, and Sonnet applies a complete
spec without over-building (the located-edits fix-up already runs sonnet/medium successfully). **Path
A, opus + the scope overlay + effort low, is the escalation** for a thin brief that needs in-run
reasoning; running Opus by default re-does the planning the gate already banked, with the
over-building model. Confirm B clears the criteria-met and build-green floor before trusting it
(experiment 6).

Status: `measured` = Opus over-builds on run, the effort-curve dominance. Hypotheses to test = Path B
faithfulness, effort-curbs-over-building, a shape critic catching real omissions. Most compensation
(the Opus overlay, the `shape` critic) also improves the Fable path, so it is worth building
regardless of pool state.

Mechanism (unbuilt): `model` is a static registry value read at spawn, so nothing detects Fable-out
or swaps the row. The routing this strategy needs, detect the Fable usage-limit signal (CLI shape
unspiked), pick the fallback row per kind at spawn, flip back on reset, is a later implementation
story. The flip is global, not per-kind: one Fable pool means one Fable-out signal swaps all six
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

**Operational: Fable usage limit.** Fable hit its usage cap during the refine test. Helm's loop
leans on Fable (refine, run, shape, define, init default to it), so the limit constrains both further
Fable testing and the live loop until it resets.

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
- **research / {sonnet, haiku} / high** (test): posed a code-verifiable three-case decision
  (ready-gate staleness handling), graded against the code. Sonnet ~$0.55 gave the complete answer
  including the subtle Case 2 sub-cases (exhausted-retry vs already-running at gate.ts:153-158).
  Haiku ~$0.21 (2.6x cheaper) got all three cases correct with no wrong claims but missed those
  sub-cases. Research is the one role where Haiku is viable: it reads and reports accurately, it
  just isn't as thorough.

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

1. **refine: Opus and Sonnet vs Fable.** The open high-value question. Refine is high error cost and
   its cost is mostly gate rounds, so a model that writes a tighter brief (fewer rounds, cleaner run)
   could pay for itself. Measure brief quality by downstream gate rounds and run outcome, not by the
   refine session cost alone.
2. **adversary: confirm the round compression end-to-end.** Run one full Opus gate on a fresh brief,
   count actual rounds to convergence against the 12→~4 estimate.
3. **run: Opus vs Fable per token.** Does Opus finish in fewer turns, offsetting its rate? High error
   cost, single invocation, so quality floor is criteria-met and review-pass.
4. **effort sweeps** on the chosen model for adversary (does high beat medium?) and run (does medium
   suffice, or does high cut turns?).
5. **research and review at Haiku.** Both are the cheapest-viable candidates; test whether Haiku
   clears their floors before paying for Sonnet.
6. **Fable fallback: `run` A/B.** Path A (opus + scope-lock prompt + effort low) vs Path B
   (sonnet/high) on one Ready story from a gated brief, identical worktrees. Metric: criteria met
   and build green, plus over-build (files touched outside blast radius). Picks the `run` fallback.
7. **Shape gate: completeness-critic recall.** Seed a shaped epic with known omissions, run the
   critic pass, measure real-omission recall vs false flags. Validates the permanent shape gate (a
   standing feature, not fallback-specific).
