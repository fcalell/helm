# Session kinds

Every `claude` process Helm spawns belongs to one **session kind**, a closed set that fixes the
prompt, tool allowlist, model, and context policy for that stage of the loop. The kind is the one
place per-stage configuration lives, so "cheap model for read-only chat, frontier model for
implementation" and "compact a long run, reseed a stale chat" are table rows, not scattered flags.
Helm stays a single fixed workflow; the kinds are its stages, never user-authored steps
([vision](../product/vision.md) §Non-goals). The artifact a kind produces is stamped from a template
([templates](./templates.md)). The CLI mechanics each kind rides on are in
[claude-integration](./claude-integration.md).

## Registry

| Kind        | Stage                                   | Tools                                          | Model  | Effort | Context               |
| ----------- | --------------------------------------- | ---------------------------------------------- | ------ | ------ | --------------------- |
| `init`      | onboard a repo: propose scaffolding      | read-only + `propose_scaffold`                  | Fable  | high   | reseed on stale       |
| `shape`     | Shaping: roadmap/feature chat → epics    | read-only + `propose_epics` / `propose_stories` / `raise_decision` | Fable | high | reseed on stale |
| `research`  | resolve a shaping decision by investigation | read-only                                    | Sonnet | high   | always cold           |
| `define`    | epic → stories                           | read-only + `propose_stories`                   | Fable  | medium | reseed on stale       |
| `refine`    | story → brief                            | read-only + `update_brief` / `resolve_question` (+ `contest_flag` during a gate round) | Fable  | medium | reseed on stale       |
| `adversary` | ready gate: attack the brief             | read-only + `flag_risk`                         | Opus   | high   | always cold           |
| `run`       | implement a Ready story                  | permission preset + `update_card`               | Fable  | medium (adaptive) | compact under pressure |
| `review`    | grade + test a finished run              | read-only + test-command Bash                   | Sonnet | high   | cold                  |
| `conflict`  | rebase conflict resolution               | worktree tools                                  | Fable  | high   | cold                  |

`ask_user` is available to every kind but `research`: it is the one primitive for a session to put
a question to the user and end its turn (§Interaction). A research session runs in the background
with nobody to ask; a question the code cannot settle comes back in the finding, and the shaping
chat raises it as a human decision. Read-only means the CLI's Read/Grep/Glob
plus the kind's board tools, with no Edit or Bash except where a row adds it.

Chat kinds (`init`, `shape`, `define`, `refine`) spawn on the user's message and bypass the run
queue; every other kind dispatches through it
([runs](../product/features/runs.md) §Queue & rate limits).

## Model per kind

Each kind names a model, passed as `--model`; the rate-limit pool is shared with interactive use,
so the cheapest model that does the job is the default ([vision](../product/vision.md) §The
constraint that shapes everything). **Sonnet is the floor**: Haiku is never assigned, because a
weak proposal or a missed fact costs more rework than the tier saves. Three models cover the
registry:

- **Sonnet** (`research`, `review`): extraction and verification against something that exists:
  narrow factual code lookups, and criteria grading against test evidence for the human who
  approves. Each output is re-checked downstream or mechanically checkable, so the floor does the
  job. Review is re-tiered when v2 self-grading makes it autonomous
  ([roadmap](../product/roadmap.md)).
- **Fable** (`shape`, `define`, `refine`, `run`, `conflict`, `init`): every kind that synthesizes
  structure, plus `conflict`: a rebase that applies cleanly can still drop one side's intent, no
  later gate re-reads the merge itself (review grades the story's criteria, not the other branch's),
  and the kind is rare enough that the tier costs nothing. Opus stays off these kinds by dominance,
  not oversight: published effort-curve benchmarks put Fable at *low* effort above Opus at its
  highest setting on agentic coding, at roughly half the per-task cost, because Opus barely improves
  with added effort while Fable climbs steeply. Any budget that affords Opus therefore affords a
  better Fable point. The curves are agentic-coding benchmarks; reading them onto the chat kinds is
  extrapolation, re-verified with the other fast-moving facts below. Opus is the recorded fallback
  for the synthesis kinds if Fable's subscription-inclusion terms shift, and the retry model when a
  run hits Fable's safety-classifier refusal (security-adjacent stories can false-positive; the
  CLI's headless refusal behavior is unspiked).
- **Opus** (`adversary`): the ready gate is critique, not coding, so the coding-benchmark dominance
  above does not reach it, and depth per pass pays twice here. The adversary runs once per gate
  round and each round drives both an adversary pass and a refine answer, so a pass that surfaces
  more real flaws cuts the round count itself. Opus front-loads the deep facets a cold reader hits:
  on the 002-01 brief one Opus pass raised the flaws Fable took rounds 7-14 to find, roughly 3x the
  depth, and it carries both Fable's mechanism recall and Sonnet's spec-completeness recall in one
  model. The CLI's own cost accounting puts Opus below Fable on measured full-task runs, so the
  deeper pass is also the cheaper one: the round compression and the per-token pool weighting (below)
  both favor it.

**Effort is the second axis, capped at high.** Models expose reasoning-effort levels (low ·
medium · high · xhigh · max; the top levels vary by model): the tier sets the capability ceiling,
effort sets how much of it a session spends per turn. max and xhigh are excluded outright for
their latency and context-window burn: high is the ceiling everywhere, `run`'s escalation
included (below).
A headless spawn sets effort with the `--effort` flag
([claude-integration](./claude-integration.md) §Invocation model). Below the cap, each kind sits
at the cheapest point that clears its quality bar, weighed by four factors: what checks the
output downstream, the kind's token volume, how steep the effort payoff is (Fable climbs with
effort; Sonnet's extraction work barely does), and interactive latency (the chat kinds bypass the
queue because a person is waiting, so their ceiling is a turn the user will sit through). High
goes where output is unchecked, stakes peak, or thoroughness is the product: `adversary`
(reasoning-dense, tiny sessions), `shape` (unchecked omissions at the frame, low volume), `init`
(one-time), `conflict` (rare, and a failed rebase wastes a queue slot), `research` (tiny volume,
and a wrong finding bakes into the epic structure with no later gate re-reading it), and `review`
(effort buys tool-call thoroughness, and evidence is review's whole product; a confidently wrong
grade miscalibrates the trust the approver puts in every other grade). Medium goes where a
stronger stage re-checks the work: `refine`, `define`, and `run` (gate-checked or review-checked,
and Fable at medium still clears every Opus setting on the published curves — `run`'s volume made
it the obvious extension of the same argument, and a miss is caught by review rather than shipped
unchecked). When quality disappoints, the tune-up order is the medium cells first; `run` also
escalates itself on evidence of failure (below). One cost to watch: long-run thinking fills the
context window sooner, so it raises compaction pressure
([claude-integration](./claude-integration.md) §Context management).

**`run`'s follow-up tier follows the review outcome.** The registry cell (medium) is every first
attempt. A request-changes exit routes the same-session resume by what its payload carries
([review](../product/features/review.md) §Three exits). Any unmet acceptance criterion or
free-form comment raises it to high, reacting to evidence of failure rather than predicting
difficulty from a brief. A payload of accepted standards findings alone drops it to Sonnet at
medium instead: applying located, prescribed edits is extraction-grade work, re-checked by the
repo's check command and the approving human, and a tier switch re-seeds the transcript into
cache either way ([claude-integration](./claude-integration.md) §Invocation model) at a third of
Fable's write rate, so the cosmetic round costs about a third (001-03's comments-only round:
$4.96 modeled at a Fable escalation against ~$1.50 at Sonnet medium; 002-06 and 002-07's
standards-only rounds then measured $1.67 and $1.49 at Sonnet medium, confirming the estimate). Refine's `trivial` size
hint is retired: it existed only to drop a high-default run to medium, which is now the
unconditional default, so the hint has nothing left to do. Dynamic model routing by prediction stays rejected.
The stage already classifies the work, so a classifier session would spend pool tokens
re-deriving a known label, and its failure mode, a hard story routed to Sonnet, costs a failed
run plus rework, the same asymmetry that sets the Sonnet floor. The follow-up routing reads the
review exit's recorded content; nothing predicts.

Two resources are easy to conflate. The **rate-limit pool** is priced per model: Fable burns it
roughly twice as fast as Opus per token (pool weighting follows per-token price) while finishing
a task in fewer tokens. The **context window** burns the same per token on every tier; effort is
what fills it faster. Model family names are stable; the exact ids, relative pool burn, effort
mechanics, and Fable's subscription-inclusion terms move fast, so re-verify against current docs
before building on them ([claude-integration](./claude-integration.md)).

## Context policies

Three policies cover every kind:

- **reseed on stale** (chats). A chat resumes by session id across days or weeks. When the
  transcript is gone (Claude Code deletes idle ones after `cleanupPeriodDays`), the resume fails
  loud and the kind starts a fresh session seeded from the card
  ([claude-integration](./claude-integration.md) §Invocation model). The user loses transcript
  scroll-back, never the artifact: the brief is the product
  ([define-refine](../product/features/define-refine.md)).
- **always cold** (`adversary`, `research`, `review`, `conflict`). These kinds never resume. Each starts fresh
  and reads the finished artifact with no chat history, which is the point of the adversary pass: a
  cold reader catches what the author and the refine chat talked themselves past.
- **compact under pressure** (`run`). A run is the one session long enough to exhaust its context
  window mid-task. The CLI auto-compacts it mid-turn, same process and same session id; the
  orchestrator forces the setting on per spawn and carries the brief in every segment's system
  prompt, so the contract survives summarization
  ([claude-integration](./claude-integration.md) §Context management).

## Interaction

Any session but `research` asks the user a question through `ask_user`: it records the question, the UI renders a
quick-reply form with a free-text fallback, and answering resumes the session with the answer. A
question arrives one at a time in dependency order and carries Claude's recommended answer, so the
user confirms or redirects, and anything the code can settle is read rather than asked
([define-refine](../product/features/define-refine.md) §Grilling). A run that calls it flips the
card to Needs input ([runs](../product/features/runs.md) §Needs input);
a chat kind renders the question inline in the drawer. This is the one interactive-question path, so
a mid-loop decision reaches the user the same way whichever stage raises it
([claude-integration](./claude-integration.md) §Board tools).
