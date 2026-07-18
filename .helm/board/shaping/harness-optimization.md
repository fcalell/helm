# Harness optimization

The frame for every model, loop, and automation decision in Helm: what the harness optimizes and the
levers that move it. Model/effort specifics and the measured evidence live in
[model-matrix.md](./model-matrix.md); the loop defects that motivated this live in
[loop-findings.md](./loop-findings.md). This doc is the umbrella those sit under.

## Objective

Minimize total pool spend plus wall-clock per shipped story, subject to each stage clearing its
quality floor, counting rework. The per-stage form of this is the matrix decision rule.

Three measured facts order the levers:

1. **Cost lives in iterations, not per-call price.** The first dogfood loop's gate was ~$86 of $122;
   round count is the multiplier on everything downstream.
2. **Within a stage, cache-read scales with context length and dominates**: ~90% of run cost, 84% of
   the refine gate-answering. Long context is expensive even at a cheap tier.
3. **Pools are separate and capped** (Fable draws its own, apart from Sonnet/Opus). Spend is bounded
   per pool, so spreading burn matters as much as reducing it.

So the heavy levers cut iterations and context length; per-call tier and effort are fine-tuning on
top. "Pick a cheaper model" is near the bottom of the list, not the top.

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
- **Skip or shorten stages by complexity** `idea`. Not every story needs a full gate. The safe form
  is right-sizing at shaping, not a predictive skip (the retired `trivial` hint was the unsafe form).

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

- **Right-size stories at shaping** `planned`. Cuts the gate and refine lines super-linearly: gate
  cost is ~ rounds × brief-length, and splitting a monolith shrinks both terms (fewer coupled attack
  surfaces to keep airtight in one round, shorter cold re-read per round). The dogfood loop's
  6-surface brief took 12 rounds; six one-surface slices converge in ~2-3 each and dispatch
  concurrently. Run and review are conserved (slightly worse: each story pays a per-story cold
  repo-read, context load, and separate review), so the split is a net win only while the gate
  dominates cost. Over-splitting inverts it, per-story overhead wins, so the optimum is the smallest
  coherent vertical slice, not maximum story count. This is a substitute for gate-efficiency, not an
  independent lever: a cheap gate shrinks its payoff.
- **Depth-per-pass on iterated critique** `live`. Opus adversary compresses rounds (one pass covered
  Fable rounds 7-14). On any iterated step per-pass quality pays twice: better output and fewer
  iterations.
- **Warm the iterative middle** `planned`. The gate re-reads the brief cold every round; one warm
  adversary session across the back-and-forth, cold pass only for sign-off, cuts the per-round
  re-read tax that is 84% of gate-answer cost.
- **Context policy per kind** `live`. Cold vs reseed vs compact sets the cache-read bill: compact a
  long run, cold-read only where freshness is the product.
- **Escalate on evidence, not prediction** `live`. Run escalates itself on a review failure; nothing
  predicts difficulty from a brief.
- **Pool-aware scheduling** `planned`. Spread burn across the Fable and Sonnet/Opus pools, use queue
  backpressure to ride out caps. The fallback strategy (matrix) is this lever's first instance.

### Cross-cutting

- **Verification placement lowers the upstream floor** `rule`. A cheap downstream check lets a cheaper
  or faster upstream model clear the bar. The permanent shape gate pays this way: it lets the shaping
  model be lighter because omissions get caught. Every gate added is a tier lowered upstream.
- **Measurement is the meta-lever** `live`. The per-stage usage ledger keeps the matrix evidence-fed.
  Every stage records cost, tokens, and rounds, so the levers get pulled on evidence, not intuition.

## Ranked leverage

Highest first, for sequencing the work:

1. **Story sizing**: cuts the gate/refine lines super-linearly, but conserved on run/review, so a net
   win only while the gate dominates cost.
2. **Iteration reduction on gates**: depth-per-pass, warm iteration, convergence automation.
3. **Context and cache discipline**: length is the hidden 80-90% of cost.
4. **Verification placement**: buys cheaper upstream tiers.
5. **Tier, effort, and prompt fit per kind**: the matrix.
6. **Deterministic-over-agentic automation**: never spawn for what code settles.
7. **Pool-aware fallback and scheduling**: bounded-pool survival.

Levers 1 and 2 both attack gate cost and are substitutes, not additive: a cheap gate shrinks the
story-sizing payoff. Build whichever is cheaper to reach; do not count both savings.

## How current decisions map

The decisions taken so far are pulls on this frame, not separate initiatives:

- **adversary to Opus/high**: levers 2 (depth-per-pass) and 5 (tier fit). `live`.
- **Fable fallback strategy**: lever 7 (pool-aware), with the Opus scope overlay as lever 3 (prompt).
  Detail in the matrix. `planned`.
- **Permanent shape gate**: lever 4 (verification placement), a new gate stage that folds into
  session-kinds.md and the roadmap when built. `planned`.
