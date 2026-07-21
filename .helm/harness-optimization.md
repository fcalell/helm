# Harness optimization

The frame for every model, loop, and automation decision in Helm: what the harness optimizes and the
levers that move it. Model/effort specifics and the measured evidence live in
[model-matrix.md](./model-matrix.md); the loop defects that motivated this live in
[loop-findings.md](./loop-findings.md). This doc is the umbrella those sit under.

## Objective

One hard constraint and two minimands, not a single sum. The **hard constraint** is staying within
each rate-limit pool's cap (a Max subscription bills nothing but caps usage); a pool-out halts that
pool's kinds regardless of how cheap each call was. Under it, **minimize pool spend** (the primary
minimand, what the matrix rule and most levers below target) and **wall-clock per shipped story** (a
secondary minimand only a few levers touch: concurrent slice dispatch and pool-aware scheduling). The
two align near the cap (exhausting a pool is a hard stop, not a throttle: it blocks that pool's kinds
until reset, a wall-clock cliff, so spending less to stay under the cap also avoids the stall) and
trade off otherwise; they are different units and are never added. The matrix decision rule is the
per-stage form of the spend minimand only, the cheapest (model, effort) clearing each stage's quality
floor, counting rework; it has no time term, so wall-clock is handled by those few levers, not the
rule.

**Cost is measured in the wrong unit, deliberately.** Every dollar figure in these docs is the CLI's
notional `total_cost_usd`, not a bill (the Max subscription has no API billing). It is a proxy for
token volume. The resource that actually runs out is a pool's usage cap, seen directly when Fable hit
its limit mid-testing. Dollars track volume *within* a pool acceptably, but do **not** compare *across*
pools: a cross-pool "$X cheaper" (e.g. Opus below Fable) says nothing about pool survival, because the
two draw different capped buckets. Read every cross-pool dollar comparison as a token-volume note,
never a which-to-run verdict; the pool it draws decides that.

First calibration of the real unit `est` (002-02): the loop drew ~5% of each pool while its dollar
split was $44.54 Fable against $29.05 Opus/Sonnet, and Anthropic sizes the Fable cap at 50% of the
Opus one. The three facts reconcile only when pool draw ≈ fresh input + output + ~2% of cache reads
(α in 0.015–0.03 under the readings' rounding). So dollars overweight cache-heavy stages even
inside one loop: the run "cost" 1.9× the gate in dollars yet drew the same fraction of its pool.
The 002-03 re-fit **could not test the point estimate**: both readings carried unledgered draws, a
parallel interactive Opus session on the shared pool plus the orchestration session's own Fable
draw. Under α≈0.02 the ledger predicts ~2% per pool; the meter read ~4% on both, so the gap on
each pool is its unledgered session's draw, size unknown. The 002-04 readings **tightened the
bounds**: the Fable pool moved 8% total while carrying 22.8M ledgered cache reads (the loop's run
plus its high-tier fix-up) beside ~587k fresh + output and two unledgered Fable sessions — at
α ≈ 0.10 the cache reads alone exceed that movement on every admissible cap, so the cache-read
weight is bounded at roughly **α ≤ 0.05**, with α≈0.02 still the best fit (ledgered ~4.5%
predicted, ~3.5% residual for the two unledgered sessions, in line with 002-03's
orchestration-only residual). Hold pool draw as fresh + output + a small cache-read term,
weighted somewhere in 0–5%. One tension opened: the shared pool was quiet for the first time
(the parallel session was Fable) and read ~4% on ~827k weighted, implying a ~21M shared window —
half the ~46M the 002-02 fit implied; either an unlogged Opus/Sonnet draw shared the window or
the 002-02 reading overestimated it. The exact before/after readings protocol resolves this next
loop. Two things survive any α: dollars overweight cache-heavy stages, and cutting iterations
cuts every component at once.

Three facts order the levers:

1. **Cost lives in iterations, not per-call price** `measured`. The first dogfood loop's gate was
   ~$86 of $122; round count is the multiplier on everything downstream.
2. **Within a stage, cache-read scales with context length and dominates the dollar proxy**
   `measured`. Cache-read was ~90% of run cost. Refine's cost was dominated the same way at one
   remove: ~78% of the chat went to re-answering the 12 gate rounds rather than building the brief,
   and 84% of its cache-reads fell in that gate-answering (each round re-reads the accumulated
   transcript). Long context is expensive even at a cheap tier. Calibration caveat `est`: the
   cache-read pool weight is bounded at α ≤ ~0.05 by the 002-04 Fable reading (cost-unit
   paragraph above), so this fact reaches pool survival only weakly; it governs modeled dollars
   and latency, while the fresh-input and output volume of the same stages is what draws the
   pool under every admissible fit.
3. **Pools are separate and capped** `measured`. Two pools, both confirmed: Fable draws its own (it
   capped out while the others ran), and Sonnet and Opus share the second. Anthropic sizes the Fable
   cap at 50% of the Opus/Sonnet one; the window sizes stay unconfirmed `est`, and the 002-04
   quiet-shared reading put them in tension: ~21M implied for the shared window against the ~46M
   the 002-02 fit implied (cost-unit paragraph above). Spend is bounded per pool,
   so spreading burn across pools matters as much as reducing it. Because the gate's adversary (Opus)
   and the Sonnet stages (research, review) draw the same bucket, the fallback must not assume a spare
   Opus pool is large or free of the Sonnet load already on it.

So the heavy levers cut iterations and context length; per-call tier and effort are fine-tuning on
top. "Pick a cheaper model" is near the bottom of the list, and on a capped pool it can even be
wrong: the cheaper-in-dollars model can draw more of a scarcer pool.

## Levers

Grouped by the three optimization handles. Tag: `live` (built), `designed` (settled, unbuilt),
`planned` (decided in these notes, needs a story), `idea` (unproven), `rule` (a standing design
principle, not a build item).

### Spawn an agent only when needed (cuts invocation count)

- **Deterministic-over-agentic** `live`. Anything code can settle, code settles, never a model. Live:
  read-rather-than-ask, follow-up routing by the recorded review payload, predictive model-routing
  rejected because the stage already classifies the work. Keep pushing convergence, freshness, and
  classification into code.
- **Convergence and dedup automation** `live`. Auto-stop at zero flags, auto-suppress already-answered
  flags, so rounds end as early as the work allows.
- **Minimize human round-trips** `designed`. `ask_user` only when code cannot settle, one question in
  dependency order, each carrying a recommended answer so the user confirms rather than authors.
- **No predictive stage-skipping** `idea` (guardrail, not a separate lever). Not every story needs a
  full gate, but the only safe way to spend fewer stages is right-sizing at shaping (below); skipping a
  gate on a *predicted*-trivial story is the unsafe form the retired `trivial` hint took. Kept here to
  mark the rejected shortcut so it is not re-proposed.

### Right agent for the task (cuts per-invocation cost and rework)

- **Tier per task character** `live`. Execution to Fable, critique to Opus, extraction and
  verification to Sonnet, accurate reading to Haiku. The capability boundary is load-bearing: Haiku
  cannot attack, Opus over-builds. Detail and evidence in the matrix.
- **Effort as the second knob** `live`. Raise only where quality keeps climbing (Fable does, Sonnet
  barely), capped at high.
- **Prompt as a behavior lever on a fixed tier** `planned`. The scope-lock overlay makes Opus stop
  over-building without a tier change: cheaper than re-tiering.
- **Decompose across models** `idea`. Split so each part hits the fitting model (plan on Opus, execute
  on Sonnet). Use sparingly: the ready gate already banks the plan, which is why run-fallback executes
  rather than re-plans.

### Run the loops optimally (cuts iterations and context, the heavy axis)

- **Right-size stories at shaping** `planned`. Attacks the gate and refine lines, which dominate when
  a story couples many surfaces. Gate cost per story is ~ rounds × brief-length, and a monolith's
  round count grows *super-linearly in coupled surfaces*: the dogfood loop's 6-surface, 28KB brief
  took 12 rounds because it could not pass until all six were airtight at once, far more than 6× a
  single surface's ~2. Slicing removes that coupling penalty. It does **not** cut aggregate passes:
  six one-surface slices at ~2-3 rounds each total 12-18 adversary passes, flat-to-higher than the
  monolith's 12. The saving is the length term: each of those passes reads a ~5KB slice instead of the
  28KB whole, a ~5× cheaper cold read per pass, so gate spend drops by roughly the round-factor
  (12 → ~2.5 per gate) as a bounded constant, not without limit. Run and review are conserved to
  slightly worse (each slice pays a per-story cold repo-read, context load, and separate review), so
  the split wins only while the gate dominates, and over-splitting inverts it once per-slice overhead
  outweighs the gate saving; the optimum is the smallest coherent vertical slice, not maximum story
  count. Slices also dispatch concurrently, but that buys wall-clock, not spend, and only up to a
  pool's rate ceiling (six concurrent Fable gates share one Fable pool). This is a substitute for
  gate-efficiency, not an independent lever: a cheaper gate shrinks its payoff, and the Opus
  adversary already halved the per-pass price (matrix experiment 2, measured), so size the
  remaining payoff at ~$2/pass, not 002-01's $3.50. First measured instance (002-03): the
  single-surface slice's gate converged in 4 cold passes against the 002-02 monolith's 12 at flat
  per-pass price, gate line $23.95 → $7.17, the round-factor saving this lever predicted; run and
  review stayed in their expected bands. Sizing happened in the orchestration session, not a
  shaping stage, so the lever's automation remains `planned` even though its effect is now
  `measured`.
- **Depth-per-pass on iterated critique** `live`. Opus adversary compresses rounds (one pass covered
  Fable rounds 7-14). On any iterated step per-pass quality pays twice: better output and fewer
  iterations.
- **Warm the iterative middle** `planned`. The adversary re-reads the full brief cold every pass (it
  is always-cold by design), which is why its line was $52.54 of the $86 gate. One warm adversary
  session across the back-and-forth, with a single cold pass only for sign-off, cuts that per-pass
  cold-read tax. Warmth is the fix, not a compressed artifact: carrying a distilled summary into each
  cold pass multiplies the dominant cache-read term by the pass count, so on a cold-by-design stage a
  warm session pays where a carried text artifact does not. (Distinct from refine's gate-answering
  cache-reads in fact 2: those are the reseed
  chat re-reading a growing transcript, not the adversary's cold reads; warm-the-middle attacks the
  adversary line, context-policy tuning attacks refine's.)
- **Context policy per kind** `live`. Cold vs reseed vs compact sets the cache-read bill: compact a
  long run, cold-read only where freshness is the product.
- **Escalate on evidence, not prediction** `live`. Run escalates itself on a review failure; nothing
  predicts difficulty from a brief.
- **Pool-aware scheduling** `planned`. Spread burn across pools and use queue backpressure to ride out
  caps. Note the asymmetry: the Fable fallback does not *spread* load, it *relocates* all six Fable
  kinds onto the one shared Sonnet/Opus pool already carrying adversary, research, and review, so it
  can cascade into a second pool-out. Scheduling must cap or queue the relocated load, not fire it all
  at once. The fallback strategy (matrix) is this lever's first instance and its hardest case.

### Cross-cutting

- **Verification placement lowers the upstream floor** `rule`, when the gate is cheaper than the
  rework it prevents. A cheap downstream check lets a cheaper or faster upstream model clear the bar,
  but the check is not free: by fact 1 a gate that iterates is itself a round multiplier, so it pays
  off only when it converges fast and catches errors that would otherwise cost a failed run plus
  fix-up. The permanent shape gate fits (a cold completeness pass, ideally one-shot per proposal,
  guarding a high-error-cost stage that has no other check); a gate that needed many rounds to clear
  would not. "Every gate added lowers a tier upstream" holds only under that convergence condition,
  not unconditionally.
- **Measurement is the meta-lever** `live`. The per-stage usage ledger keeps the matrix evidence-fed.
  Every stage records cost, tokens, and rounds, so the levers get pulled on evidence, not intuition.
  The pool-unit re-fit exposed two limits. One-digit meter deltas read across loops under
  concurrent external use cannot identify the pool weighting: a calibration loop needs quiet
  pools, exact before/after meter values, and the window's reset clock (`rate_limit_event`
  already reports it) so the reading's window is known. And the orchestration session is a blind
  spot: excluding it keeps the dollar ledger honest, but its Fable-pool draw is real,
  loop-length, and never recorded, so per-pool attribution undercounts Fable by construction.

## Ranked leverage

Ordered by *gross* leverage on the spend minimand (wall-clock ranks separately, under concurrency and
scheduling), **not** a build sequence and not remaining leverage: several of these are already banked
`live`, which lowers what is left to gain (deterministic-over-agentic at 6 is foundational but mostly
built; the Opus adversary has already taken part of 1 and 2). Read the number as "how much this axis
moves the objective," then discount by what is already `live`.

1. **Story sizing**: cuts the gate/refine lines by a bounded constant factor (removes the coupled-
   surface round penalty), but conserved on run/review, so a net win only while the gate dominates.
2. **Iteration reduction on gates**: depth-per-pass, warm iteration, convergence automation.
3. **Context and cache discipline**: length is the hidden 80-90% of *modeled* cost; its pool-axis
   demotion now rests on measurement (the 002-04 Fable reading bounds the cache-read weight at
   α ≤ ~0.05), so treat the lever as certain on dollars and latency and weak on cap survival,
   where levers 1 and 2, which cut fresh input and output, defend the caps under every
   admissible fit.
4. **Verification placement**: buys cheaper upstream tiers, when the gate itself converges cheaply.
5. **Tier, effort, and prompt fit per kind**: the matrix.
6. **Deterministic-over-agentic automation**: never spawn for what code settles.
7. **Pool-aware fallback and scheduling**: bounded-pool survival. (The exception on this list: it
   serves the hard constraint, not the spend minimand, and ranks last because it is a fallback to ride
   out a cap, not a spend optimizer.)

Levers 1 and 2 both attack gate cost and are substitutes, not additive: a cheaper gate shrinks the
story-sizing payoff. The `adversary` → Opus change (levers 2 and 5) is merged and measured
end-to-end (matrix experiment 2, 002-02): the projected 12→~4 pass compression did not
materialize (12 passes to zero on a single-story brief; fix-then-re-attack ratchets one seam per
pass whatever the depth), yet the adversary line still halved, $52.54 → $23.95, on per-pass price.
Lever 2's remaining headroom is therefore convergence automation and a warm middle that actually
cuts passes, not tier depth; lever 1's payoff prices at ~$2/pass. Build whichever of 1/2 is
cheaper to reach next; do not count both savings.

## How current decisions map

The decisions taken so far are pulls on this frame, not separate initiatives:

- **adversary to Opus/high**: levers 2 (depth-per-pass) and 5 (tier fit). `live`.
- **Fable fallback strategy**: lever 7 (pool-aware), with the Opus scope overlay as the prompt half of
  lever 5 (tier, effort, and prompt fit). Detail in the matrix. `planned`.
- **Permanent shape gate**: lever 4 (verification placement), a new gate stage that folds into
  session-kinds.md and the roadmap when built. `planned`.
