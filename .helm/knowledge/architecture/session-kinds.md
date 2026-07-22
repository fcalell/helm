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
| `research`  | resolve a shaping decision by investigation | read-only                                    | Opus   | medium | always cold           |
| `define`    | epic → stories                           | read-only + `propose_stories`                   | Fable  | medium | reseed on stale       |
| `refine`    | story → brief                            | read-only + `update_brief` / `resolve_question` (+ `contest_flag` during a gate round) | Fable  | medium | reseed on stale       |
| `adversary` | ready gate: attack the brief             | read-only + `flag_risk`                         | Opus   | high   | always cold           |
| `run`       | implement a Ready story                  | permission preset + `update_card`               | Opus   | medium (adaptive) | compact at boundaries  |
| `review`    | grade a finished run's criteria          | read-only + check-command Bash + `grade_criteria` | Opus   | high   | always cold           |
| `conflict`  | rebase conflict resolution               | worktree tools                                  | Fable  | high   | always cold           |

`ask_user` is available to every kind but `research`: it is the one primitive for a session to put
a question to the user and end its turn (§Interaction). A research session runs in the background
with nobody to ask; a question the code cannot settle comes back in the finding, and the shaping
chat raises it as a human decision. Read-only means the CLI's Read/Grep/Glob
plus the kind's board tools, with no Edit or Bash except where a row adds it.

Chat kinds (`init`, `shape`, `define`, `refine`) spawn on the user's message and bypass the run
queue; every other kind dispatches through it
([runs](../product/features/runs.md) §Queue & rate limits).

## Prompts

Each kind's prompt **replaces** the CLI's default system prompt (`--system-prompt`,
[claude-integration](./claude-integration.md) §Invocation model); nothing of the default's text
reaches a Helm session. Replacement was measured against append across four kinds
(`.helm/research/experiments/system-prompts/plan.md`): quality held or improved everywhere, and the standards
review doubled its verified findings under the same tool narrowing. The registry row holds the
prompt as a spec (`kinds.ts` `KindPromptSpec`), and `composePrompt` joins it in a fixed frame:
role paragraph, kind body, shared blocks, stopping clause last. Per-repo prompt overrides are a
planned feature that replaces only the body; the frame is not editable, because a whole-prompt
edit that reintroduces a labelled skeleton raises that kind's draw by half again (below).

Three authoring rules are measured, not stylistic:

- **Directive prose, never labelled sections.** A `Role`/`Method`/`Output` skeleton is read as a
  procedure to execute: on the same brief it cost 15.6 extra tool calls per pass and returned
  fewer flags than the identical content as prose. One paragraph naming the role and the work,
  then the output contract.
- **Restate what the default prompt carried.** Replacement drops the default's stopping
  heuristics and tool-usage rules, and a session without a stopping clause keeps exploring past
  its conclusion (+6 calls per pass measured). Every prompt ends on the shared stopping clause;
  kinds with Edit/Bash also carry the shared tool-mechanics block (`kinds.ts`).
- **The prompt is static per kind.** Shared blocks are byte-identical constants, and nothing
  varying per pass (cwd, git state) enters the system prompt, so a cold kind's re-spawns share a
  prompt-cache prefix. Per-spawn context (the brief, the refine seed) appends after the kind
  prompt.

A rule stated as an absolute does not buy compliance (the run arm broke its own "never grep
through Bash" rule as often as the control broke a preference); shrinking the context is what
reduced contract-edge events. Write the rule once and keep the prompt short rather than
escalating the wording.

## Model per kind

Each kind names a model, passed as `--model`; the rate-limit pool is shared with interactive use,
so the cheapest model that does the job is the default ([vision](../product/vision.md) §The
constraint that shapes everything). **Sonnet is the floor**: Haiku is never assigned, because a
weak proposal or a missed fact costs more rework than the tier saves. Two models cover the
registry, with the split drawn on what a kind produces rather than on price:

- **Opus** (`adversary`, `run`, `review`, `research`): every kind whose output nothing downstream
  re-derives. Critique, execution, grading, and factual lookup all land here, each for its own
  reason. On `adversary`, depth per pass pays twice: the gate runs one pass plus one refine answer
  per round, so a pass that surfaces more real flaws cuts the round count itself, and one Opus pass
  raised the flaws Fable took rounds 7-14 to find on the 002-01 brief. On `run`, Opus 5 finished
  002-01 in 15.2 minutes and 125 turns with a green check against Fable's 21 minutes and 136 turns,
  and its report named what it could not verify rather than papering over it. On `review`, Opus 5
  returned 6 verified should-fix findings where Sonnet 5 returned 1, at lower cost, and it caught a
  hash-staling defect eight loops of Sonnet review had missed. On `research`, all tiers clear the
  floor, so the kind follows the pool consolidation rather than a quality argument.
- **Fable** (`shape`, `define`, `refine`, `conflict`, `init`): the kinds that synthesize structure
  under a later gate. Each proposal is re-checked before it binds: shaping and define land proposals
  the user resolves, refine answers to the ready gate, and `conflict` is rare. Published effort
  curves put Fable at low effort above Opus at its highest on agentic coding, at roughly half the
  per-task cost, and reading them onto the chat kinds is extrapolation. Those curves no longer reach
  `run`: measured on the same story, Opus 5 beat Fable on wall-clock, turns, and self-report honesty,
  which is the result that moved `run` off this row. `refine` stays here on absent evidence rather
  than a measured win: the Opus 5 sweep never ran a Fable arm, because Fable's pool was capped.

Evidence for the Opus rows is the Opus 5 sweep in `.helm/research/model-matrix.md` §Opus 5 sweep. Two
consequences of the split are worth holding: **Sonnet is now assigned to no kind**, so it survives
only in the `KindRow` union as the recorded fallback tier, and the pool balance moved (below).

**Effort is the second axis, capped at high.** Models expose reasoning-effort levels (low ·
medium · high · xhigh · max; the top levels vary by model): the tier sets the capability ceiling,
effort sets how much of it a session spends per turn. max and xhigh are excluded outright for
their latency and context-window burn: high is the ceiling everywhere, `run`'s escalation
included (below).
A headless spawn sets effort with the `--effort` flag
([claude-integration](./claude-integration.md) §Invocation model). Below the cap, each kind sits
at the cheapest point that clears its quality bar, weighed by four factors: what checks the
output downstream, the kind's token volume, how steep the effort payoff is (Fable climbs with
effort; Opus stays flatter), and interactive latency (the chat kinds bypass the
queue because a person is waiting, so their ceiling is a turn the user will sit through). High
goes where output is unchecked, stakes peak, or thoroughness is the product: `adversary`
(reasoning-dense, tiny sessions), `shape` (unchecked omissions at the frame, low volume), `init`
(one-time), `conflict` (rare, and a failed rebase wastes a queue slot), and `review`
(effort buys tool-call thoroughness, and evidence is review's whole product; a confidently wrong
grade miscalibrates the trust the approver puts in every other grade). Medium goes where a
stronger stage re-checks the work or where added effort measurably buys nothing: `refine` and
`define` (gate-checked, and a miss is caught by review rather than shipped unchecked), `run` (Opus 5
at medium shipped 002-01 green, so the tier's ceiling is not what limits it), and `research` (tiny
volume, and all three tested tiers returned the complete answer, so effort is not the binding
constraint). When quality disappoints, the tune-up order is the medium cells first; `run` also
escalates itself on evidence of failure (below). One cost to watch: long-run thinking fills the
context window sooner, so it raises compaction pressure
([claude-integration](./claude-integration.md) §Context management).

**`run` escalates on a follow-up, not on a prediction.** The registry cell (medium) is every first
attempt. A request-changes exit resumes the same session at high effort, reacting to evidence of
failure rather than predicting difficulty from a brief: every comment the payload can carry is an
unmet acceptance criterion or a free-form note, and both mean the first attempt missed
([review](../product/features/review.md) §Three exits). An effort switch re-seeds the transcript
into cache ([claude-integration](./claude-integration.md) §Invocation model), and that reseed, not
the fix, is what the round costs (002-04's high-tier escalation ran $9.18 on ~247k of reseed against
$1.61 and $1.49 for the cosmetic rounds on 002-03 and 002-07). Those cosmetic figures were measured
at Sonnet medium, before `run` moved to Opus, so they are the shape to expect and not the price.
**Only the effort axis moves; the model stays put.** The resume continues the run's own session, so
a model switch would discard its warm cache along with the tier, and `review.ts` holds the resume at
the `run` row's model. Dynamic model routing by prediction stays rejected. The stage already
classifies the work, so a classifier session would spend pool tokens re-deriving a known label, and
its failure mode, a hard story routed to a weak tier, costs a failed run plus rework, the same
asymmetry that sets the Sonnet floor.

Two resources are easy to conflate. The **rate-limit pool** is priced per model: Fable burns it
roughly twice as fast as Opus per token (pool weighting follows per-token price) while finishing
a task in fewer tokens. The **context window** burns the same per token on every tier; effort is
what fills it faster. The pools are separate and separately capped, so the split above also decides
where a cap bites: `run` moving to Opus takes the heaviest line off the Fable pool and puts it on the
one already carrying `adversary` and two `review` sessions per run. That pool's window is unmeasured
(`.helm/research/harness-optimization.md` §Objective holds it between ~21M and ~46M weighted tokens), so read
the meter across the first loops on this split. Model family names are stable; the exact ids, relative pool burn, effort
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
- **compact at boundaries** (`run`). A run is the one session long enough to exhaust its context
  window mid-task. The CLI auto-compacts it in the same process and session id; the orchestrator
  forces the setting on per spawn and carries the brief in every segment's system prompt, so the
  contract survives summarization. A PreCompact hook decides *when* and steers *what survives*:
  compaction is deferred while the worktree has uncommitted edits, so a summary is written against
  committed work rather than a half-finished change, and the compaction that does run is told to
  drop what the worktree can give back (file contents, dead-end exploration) and keep what it
  cannot (commits, decisions and their rejected alternatives, open criteria, loose ends). The
  deferral is bounded at three refusals, because a blocked compaction near the ceiling ends in an
  unrecoverable "Prompt is too long" ([claude-integration](./claude-integration.md) §Context
  management).

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
