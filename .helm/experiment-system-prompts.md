# Experiment: custom system prompts per stage

Measures replacing Claude Code's default system prompt with a Helm-authored one per session kind.
Today every kind appends its contract to the default (`runner.ts:146`, `--append-system-prompt`);
every kind moves to `--system-prompt`, with the prompts editable per repo. The measurement's remaining
job is how those prompts are written, which §Prompt design rules and §Verdict answer. Frame and levers
in [harness-optimization.md](./harness-optimization.md) (lever 5, prompt fit); measured tier data in
[model-matrix.md](./model-matrix.md).

## What we are testing

Two hypotheses, each with its own metric.

**H1, objective conflict.** The default prompt carries goals that are not the stage's: interactive
brevity, task-tracking rituals, commit trailers, tools the kind is denied. Every counter-instruction
in `kinds.ts` is a symptom. Removing the competing text should raise recall and format compliance,
strongest on the small cold kinds where the fixed prompt is a large share of the context
(`adversary`, `review`, `research`). Metric: findings recall against verified ground truth, plus
false positives.

**H2, instruction decay.** Opus 5 follows the contract less completely after working for a while.
Metric: a per-item contract checklist scored from the transcript and the git state, so "drifted" is a
number instead of an impression. Only `run` is long enough to show it.

The two are separable: H1 shows up on a single cold pass, H2 only across a long session. Do not read
one as evidence for the other.

## Prerequisites: measured (2026-07-27, CLI 2.1.220)

**P1, the capture probe (zero pool).** `ANTHROPIC_BASE_URL` pointed at a local recorder that saves
the request body and answers 400. It intercepts under subscription auth, so the whole measurement
costs nothing. Two results.

*The memory gate is clear.* `CLAUDE.md` and its `@` import chain survive `--system-prompt`. They
never rode the system prompt: the CLI injects them as a `<system-reminder>` block in the first user
message, which `--system-prompt` does not touch. What the replacement does drop is the `gitStatus:`
block, and every kind that wants git state can run `git status` itself.

*The system prompt is the small half of the overhead.* Measured on this repo, one turn, adversary
flags:

| Component                            | chars   | ~tokens |
| ------------------------------------ | ------- | ------- |
| default system prompt (system[2])    | 8,439   | 2,281   |
| built-in tool schemas (30 tools)     | 87,357  | 23,610  |
| `CLAUDE.md` reminder (first message) | 10,114  | 2,734   |
| agent + skill registries (msg[1])    | 7,995   | 2,161   |
| **total fixed overhead**             | 114,077 | 30,832  |

Replacing the system prompt removes 2,280 tokens of that, 7%. The tool schemas are 77% of it, and
`Workflow` alone (5,765) is larger than the entire default prompt. The agent and skill registries
arrive as a `system`-role message and disappear when `Agent` and `Skill` are undefined.

**P2, `--tools` narrowing.** Verified working under `-p`, and MCP board tools survive it: with
`--tools Read Grep Glob`, `system/init` still reports `mcp__helm__flag_risk` and the captured request
still carries its schema. One trap, and it is load-bearing. Helm allowlists `Read,Grep,Glob` but the
CLI's own read-only classification lets those sessions run read-only Bash anyway, which every
recorded pass used heavily (`git diff` is how the review kind sees its diff at all). Narrowing to
`Read Grep Glob` deletes that capability silently. The correct narrowing keeps `Bash`.

Fixed overhead by arm, same turn, same repo:

| Arm                                            | ~tokens | vs today |
| ---------------------------------------------- | ------- | -------- |
| append + all tools (today)                     | 30,832  | -        |
| replace + all tools                            | 28,552  | −7%      |
| append + `--tools Read Grep Glob Bash`         | 6,515   | −79%     |
| replace + `--tools Read Grep Glob Bash`        | 4,992   | −84%     |

## Prompt design rules

The drafts below follow six rules, aimed at H2 as much as at length.

1. **One directive paragraph, then the output contract.** Measured, and the reverse of what this plan
   first drafted: the labelled `Role`/`Tools`/`Method`/`Output`/`Never` skeleton cost 15.6 extra tool
   calls a pass on `adversary` and returned fewer flags than the same content as prose (§Verdict). A
   section headed `Method` is read as a procedure to execute. State the role and the work in one
   paragraph, then the output contract.
2. **Imperatives, no rationale.** Why a rule exists lives in `.knowledge/`. A prompt states the rule.
3. **Absolutes last.** The most-violated rules sit at the recency position, phrased as unconditional
   single clauses with no nesting. Untested: no arm varied ordering.
4. **Seven invariants maximum** per kind. Past that, ranking decides what gets cut, not the author's
   comfort.
5. **One name per thing.** The tool name, the section name, the field name, repeated exactly. No
   synonyms.
6. **Byte-identical shared blocks** across kinds. The cold kinds re-spawn the same prompt every pass,
   so an identical prefix can hit the prompt cache across passes; today the default's cwd and
   git-status sections change between passes and break it.

Length is not the point, and the drafts are honest about it. Helm's own text stays in its current
band because every constraint in it was earned:

| Kind        | Current prompt | Draft   |
| ----------- | -------------- | ------- |
| `init`      | 60 words       | 55      |
| `shape`     | 303 words      | ~280    |
| `research`  | 71 words       | 70      |
| `define`    | 203 words      | ~180    |
| `refine`    | 358 words      | ~330    |
| `adversary` | 113 words      | 105     |
| `run`       | 203 words      | ~250    |
| `review`    | absent         | 2 × ~90 |
| `conflict`  | absent         | ~95     |

The context reduction is the default prompt Helm stops sending, measured by P1. `run` grows, because
the tool-mechanics block it inherits today has to be written out.

## Shared blocks

```
READ_ONLY
Tools: Read, Grep, Glob. Never edit a file. Never run a command.

BOARD_OUTPUT
Output: structured output goes through your board tools, and each call records a proposal the user
resolves. Never paste structure into prose. To ask the user something, call ask_user with your own
recommended answer, then end your turn.

GRILLING
Method: read before you ask. Settle from the code anything the code can settle. Ask through ask_user,
one question per turn in dependency order, never a bulk list. Propose nothing until the user confirms
the shared understanding.

VERTICAL_SLICE
Every story is a vertical slice: a thin path through every layer, demoable on its own. Never one
layer that does nothing until the others land. Give each story a one-line goal and dependency hints
naming sibling slugs.

TOOL_MECHANICS (Edit/Write/Bash kinds only)
Tool rules: read a file before you edit it, and Edit matches the file's exact current text including
indentation. Paths are absolute. Search with Grep and Glob, never grep or find through Bash. Send
independent tool calls in one message. A call you did not see succeed did not succeed.

HEADLESS
You run headless. Ending your turn ends this process and kills anything it left running, so never end
a turn to wait on background work; poll in the foreground instead.
```

## Draft prompts

**Every draft below is in the skeleton shape rule 1 now forbids, and needs reshaping into prose before
it ships.** The `adversary` draft is the one that was measured, and it lost to the same content as a
directive paragraph on both cost and yield (§Verdict). The content of each draft stands; the shape
does not.

### adversary

```
Role: Helm's ready-gate adversary. Attack the implementation brief in your prompt for the gaps,
risks, and ambiguity a cold implementer would hit.

{READ_ONLY}

Method: check every claim the repository can check, and check the file:line anchors, symbol names,
and existing behavior the brief builds on. A claim the code confirms is settled. A claim you cannot
verify is a flag.

Output: one flag_risk call per critical flaw, carrying a short title plus detail naming where an
implementer stumbles. If the brief holds, call no tools and end your turn.

Never write a prose summary of your findings. Never raise a flaw you have not tried to check against
the code. Never re-raise a risk the user dismissed.
```

### research

```
Role: Helm's research session. Settle the decision question in your prompt by investigating the
repository.

{READ_ONLY}

Output: your final message is the finding, folded verbatim into the shaping thread. State the answer
directly in a few sentences, with the files and symbols that settle it.

Nobody can answer a follow-up question. Never guess: when the code cannot settle the question, say so
in the finding.
```

### review, spec axis

```
Role: Helm's spec review. Grade the finished work against the acceptance criteria in your prompt.

Tools: Read, Grep, Glob, and the repo's test commands through Bash. Never edit a file.

Method: grade each criterion from the code and from commands you run yourself. Prove what can be
proven by running it.

Output: one final message carrying every criterion, its grade of pass, fail, or unclear, and its
evidence: a file:line reference, or the command you ran and its output. Name which test commands ran.
A criterion you proved by running a test is met. A criterion graded from reading alone, or covered by
no automated test, is unclear and carries the steps a human follows to verify it by hand.

Never grade from the run's own report. Never grade intent instead of behavior. Never return a grade
with no evidence: grade it unclear instead. Never split the findings from the verdict; both go in the
final message.
```

### review, standards axis

```
Role: Helm's standards review. Judge whether the diff follows the repo's own rules, whatever the
brief asked for.

Tools: Read, Grep, Glob, and the repo's test commands through Bash. Never edit a file.

Method: the rules are the repo's root CLAUDE.md and the rules under .helm/agents/, plus common code
smells. Read them first, then the diff.

Output: one final message carrying every finding and the verdict. Each finding names the file:line,
the rule it breaks, and the edit that fixes it. Separate should-fix findings from nits.

Never grade acceptance criteria: a separate session owns that axis. Never report a rule you did not
read in this repo's rules. Never return a verdict with the findings left in your earlier narration;
the final message is the only output that reaches the user.
```

### run

```
Role: Helm's implementation run. Deliver the story brief in your system instructions, working
entirely inside this worktree.

{TOOL_MECHANICS}

Method: build exactly what the brief specifies. Deliver no adjacent improvement, no unrequested
structure, no refactor the brief did not ask for. Your prompt names the repo's check command when one
is configured: run it to self-test before finishing. When none is configured you cannot self-test.

Output: commit on the current branch as Conventional Commits (feat, fix, chore, docs, refactor,
test), header under about 60 characters, body saying the why. Before finishing, record closing notes
through update_card: the check command's outcome, plus one "verify:" bullet per behavior a human must
check by hand.

When a genuine mid-run decision only the user can settle comes up, call ask_user with your
recommended answer and end your turn; the user's answer resumes this session.

{HEADLESS}

Never push. Never switch branches. Never edit a file under .helm/: note decisions and progress
through update_card. Never guess a check command. Never retry a denied tool call: the action is
outside the run contract or the user denied it, and either way the answer is final.
```

### refine

```
Role: Helm's story refinement chat. Refine the story into an implementation brief with the user.

{READ_ONLY}
{BOARD_OUTPUT}
{GRILLING}

The brief is the artifact; the chat is disposable.

Method: fill the brief one section at a time through update_brief, in template order: Goal, Approach,
Blast radius, Acceptance criteria, Out of scope, Open questions. Propose a section only once its
ground is settled.

Approach opens with measured facts. Before any design, verify the file:line anchors, symbol names,
and existing behavior the story builds on, list them under the commit you checked them against, and
phrase the design as building on those anchors. The ready-gate adversary checks anchors it can
verify, and prose it can only doubt becomes a flag.

Acceptance criteria are a "- [ ]" checklist of measurable, testable statements: name the observable
behavior and how to check it.

Anything genuinely the user's call is an open question. Land it in Open questions through
update_brief as a "- [ ]" line, and surface it through ask_user with quick-reply options, quoting the
checklist text verbatim. When the user answers, call resolve_question with that question text and the
answer.

During a ready-gate round you receive the adversary's flags. Answer every flag the same turn: a fix
is an update_brief proposal whose resolves field names the flag's title verbatim, and a contest is a
contest_flag call naming the title verbatim with your counter-argument.

Never write a criterion that cannot be checked, like "works well". Never answer a flag by editing
around it. A text reply to a proposal means revise and re-propose.
```

### shape

```
Role: Helm's shaping chat. Explore a roadmap idea with the user and shape it into epics.

{READ_ONLY}
{BOARD_OUTPUT}
{GRILLING}

Read the current board under .helm/board/ so the shape fits what exists.

The shaping thread file is the artifact; the chat is disposable.

Method: build its Decisions checklist first. Raise every unsettled call with raise_decision, tagged
by who settles it: settledBy "human" for the product and priority calls only the user can make,
"research" for factual questions the code can answer. Surface each open human decision through
ask_user, quoting the decision text verbatim, so the answer checks the item off and folds into the
agreed notes.

Output: once no decision is open, call propose_epics with the breakdown. An epic may carry draft
stories, so one accept lands the epic with its first cards. {VERTICAL_SLICE}

Never call propose_epics while a decision is open; the tool refuses. Never paraphrase a decision when
you surface it. A text reply to a proposal means revise and re-propose.
```

### define

```
Role: Helm's epic breakdown chat. Split the epic in your prompt into stories with the user.

{READ_ONLY}
{BOARD_OUTPUT}
{GRILLING}

Output: once the understanding is confirmed, call propose_stories with the full breakdown plus the
epic's goal and breakdown rationale; accepting completes the epic file with them. {VERTICAL_SLICE}

The user resolves each story card. A text reply like "merge 2 and 3" means propose a revised
breakdown.

Never propose a partial breakdown to get started. Never leave a story without its one-line goal.
```

### init

```
Role: Helm's repo onboarding chat. Survey the repository and propose Helm scaffolding with the user.

{READ_ONLY}
{BOARD_OUTPUT}

Method: read the repo's build, test, and lint setup, its existing rules files, and its layout before
proposing anything. Name what you found; propose scaffolding that fits it.

Never propose scaffolding a repo already has. Never guess a check command: read it from the repo's
own config.
```

### conflict

```
Role: Helm's conflict resolution session. Resolve the rebase conflicts in this worktree.

{TOOL_MECHANICS}

Method: for each conflicted file, read both sides, then read the git log for each side's commits to
learn what each change intended. Resolve so both intents survive.

Output: stage each resolution and continue the rebase. Your final message names every file you
resolved and what you kept from each side.

{HEADLESS}

Never take one side wholesale without stating what it drops. Never leave a conflict marker in a file.
Never edit a file under .helm/. Never push. Never abandon the rebase: when a conflict cannot be
resolved safely, stop and report which file and why.
```

## Test matrix

Every arm replays a recorded step against ground truth, the Opus 5 sweep protocol
([model-matrix.md](./model-matrix.md) §Opus 5 sweep): `spawn.sh` mirrors `runner.ts` flags, the repo
sits at the recorded commit, and the control is that section's measured number at the same harness.
Run two samples on the replace arm wherever a pass costs under $3, because every sweep figure is a
single stochastic sample.

**Tier 1, existing ground truth, high signal, ~$11.**

| Arm                  | Replay                                | Ground truth                                      | Metric                                              | Cost/pass |
| -------------------- | ------------------------------------- | ------------------------------------------------- | --------------------------------------------------- | --------- |
| `adversary` replace  | 002-01 pass-15 brief at 89a78ef       | the verified union of 9 flags (Opus 5's 6 + 4.8's 3) | real flags found, false positives                 | ~$2.6     |
| `review` standards   | pre-fix tip 2c9dc26                   | the 11 verified findings                          | should-fix count, false positives, sentinel below   | ~$2.4     |
| `research` replace   | ready-gate staleness, three cases     | all three cases plus the retry sub-cases at `gate.ts:153-158` | cases correct, citations verified       | ~$0.5     |

The `review` arm has a sentinel: the first-run-note hash-staling defect (`hash.ts:24-32`), which eight
loops of Sonnet review missed and Opus 5 caught. A replace arm that loses the sentinel fails
regardless of its total count.

**Tier 2, the decay hypothesis, ~$10.** `run` replace on 002-01 from the gated brief, worktree at
89a78ef, lite contract, against Opus 5's baseline: 15.2 min, 125 turns, $10.39, 26 files, 1231
insertions, one Conventional Commit, clean tree, `pnpm check` verified exit 0 out of band. Score H2
from a contract checklist, each item binary, scored from the transcript and the git state:

1. `pnpm check` run before finishing, verified out of band.
2. Every commit Conventional, header under ~60 chars, body says why.
3. No commit outside the story's scope.
4. No `.helm/` file edited.
5. No push, no branch switch.
6. Closing `update_card` note present, carrying the check outcome.
7. At least one `verify:` bullet per behavior needing a human check.
8. No denied tool call retried.

Record the turn index of each violation. Late-clustered violations support H2; evenly spread ones
point at the prompt, not decay.

**Tier 3, weak or absent ground truth, defer.** `refine` has the v0-authoring-plus-judge protocol,
but its own data reads it as a low-leverage stage, so it ranks below tiers 1 and 2. `shape`, `define`,
and `init` have no recorded ground truth and need a judge protocol built first. `conflict` needs a
synthetic conflict fixture. Write these prompts now, test them after tier 1 reports.

Total for tiers 1 and 2: about $22, against the Opus 5 sweep's $31.53.

## Results: tier 1 (2026-07-27)

Three arms per kind where the question needed them, all on the same harness as the Opus 5 sweep
(`spawn.sh` mirroring `runner.ts`, fixture worktrees at the recorded commits, the sweep's own prompt
files byte-identical for the append arms). **R** replaces the system prompt and narrows `--tools`;
**T** keeps the sweep's prompt and narrows `--tools` alone; **Rfull** replaces the prompt at the full
tool set. The control column is the sweep's recorded number.

| Kind        | Arm      | Cost  | Turns | Secs | Output                    |
| ----------- | -------- | ----- | ----- | ---- | ------------------------- |
| `research`  | control  | $0.51 | 8     | 40   | 3/3 cases + sub-cases     |
| `research`  | R        | $0.34 | 9     | 41   | 3/3 cases + sub-cases     |
| `research`  | T        | $0.35 | 9     | 33   | 3/3 cases + sub-cases     |
| `adversary` | control  | $2.64 | 34    | 530  | 6 flags                   |
| `adversary` | R        | $2.85 | 45    | 514  | 7 flags                   |
| `adversary` | T        | $2.37 | 37    | 441  | 6 flags                   |
| `review`    | control  | $2.43 | 31    | 466  | 6 should-fix + 5 nits     |
| `review`    | R        | $1.99 | 30    | 351  | 11 should-fix + 6 nits    |
| `review`    | T        | $2.18 | 33    | 433  | 3 should-fix + 6 nits     |
| `review`    | Rfull    | $2.80 | 37    | 480  | 9 should-fix + 7 nits     |

**The 84% prefix cut does not become an 84% cost cut.** Cache reads scale with the transcript, and
the transcript dwarfs the prefix by the third turn. Measured end to end: `research` −34%, `review` R
−18%, `adversary` R +8%. A session that explores more spends what the prefix saved, which `adversary`
R did (45 turns against the control's 34).

**Both `adversary` arms found a defect that shipped, and neither control did.** R and T opened on the
same flag: the note-excluding hash stales the gate verdict on the first run note, because
`appendToSection` leaves two newlines before the heading that `stripRunNotes` then returns. That is
`loop-findings.md` §Gate item 2, the live defect the standards review caught only after the code
shipped and eight loops of Sonnet review missed. Both arms derived it from the brief alone, before
any code existed. Both arms narrow `--tools`, and the arm that separates the levers cannot separate
this one: T carries the control's prompt byte for byte, so the prompt is not what found it.

**The `review` sentinel went the other way, and no lever explains it.** The first-run-note hash
finding is the sentinel for the review arm, and all three new arms missed it while the control caught
it. That covers every cell: append + narrow missed it, replace + narrow missed it, replace + full
tools missed it. A lever that only appears in one cell cannot cause a miss in all three. Read it as
sample noise on a hard finding, the same pass-to-pass disjointness the sweep recorded on `adversary`
(Opus 5 and Opus 4.8 raised disjoint flag sets on the same brief).

**Recall against a union of prior passes cannot grade these arms.** Of the 9-flag `adversary` union,
R matched roughly 4 and T roughly 3, while both added the hash defect neither union pass had. The
control itself matched 6 of 9. When the spread between two runs of the *same* configuration is that
wide, a single pass per arm measures variance, not the lever. Grading `adversary` and `review` this
way needs several samples per arm. `adversary` got them (§Verdict): three per arm settle the cost
question and leave the flag-count question exactly where one sample left it.

**What is decision-grade.** `research` holds its complete answer including the discriminating
sub-cases at a third less cost, on both arms. `review` R returned 11 should-fix findings against the
control's 6, and its extra findings are substantive (the per-run settings file leaking its live hook
token, an orphaned process group when the pid write fails, `SESSION_COLD` reused for a kind that is
not cold). `review` T, the same narrowing under the old prompt, returned 3. That is the one place the
prompt rewrite and the tool narrowing separate cleanly, and it favours the rewrite.

## Results: tier 2, the decay hypothesis (2026-07-27)

One `run` arm, replace plus `--tools Read Grep Glob Bash Edit Write`, on 002-01 from the gated brief
in a fresh worktree at 89a78ef, lite contract, against the sweep's recorded Opus 5 run. The brief
text inside the two system prompts is byte-identical; only the contract wrapper around it differs.

| Measure                          | control  | replace + narrow |
| -------------------------------- | -------- | ---------------- |
| Cost                             | $10.39   | $6.83            |
| Weighted pool draw (α=0.02)      | 546,987  | 373,660          |
| Cache reads                      | 12.81M   | 7.24M            |
| Wall clock                       | 15.2 min | 13.2 min         |
| Turns (`result.num_turns`)       | 125      | 101              |
| Files changed / insertions       | 26/1231  | 23/1173          |
| `pnpm check`, verified out of band | exit 0 | exit 0           |

Both arms score identically on the hard contract items: one Conventional Commit with a why-carrying
body, clean tree, no push, no branch switch, no `.helm/` edit, no denied call retried, and a closing
report whose `verify:` bullets name what a human must check by hand. Both name the sparse-checkout
sequence as never executed rather than claiming it works, so the honesty axis holds on the shorter
prompt.

**The decay signature is in the control, and the narrow arm has less of it.** Counting every
contract-edge event (a denied tool call, or a `grep`/`find` run through Bash where Grep and Glob
exist) and placing it in the session by turn index:

| Arm              | Events | Past the halfway turn |
| ---------------- | ------ | --------------------- |
| control          | 14     | 11 (79%)              |
| replace + narrow | 7      | 3 (43%)               |

The control's events pile up at the end: eight of its ten denials fall after turn 96 of 166. That is
the shape the decay hypothesis predicts, and it is the first measurement of it in this repo. The
narrow arm halves the event count and flattens the distribution. One sample per arm, two levers
moving at once, so this ranks the hypothesis as live rather than settled.

**An explicit rule does not buy compliance.** The replacement prompt states "Search with Grep and
Glob, never grep or find through Bash" as an absolute. The arm broke it three times (turns 3, 36,
109) against the control's four, and the control's prompt only says to prefer the dedicated tools.
Writing a stronger rule bought roughly nothing; shrinking the context is what moved the count.

## Verdict

Every kind moves to a Helm-authored prompt, and the prompts become editable per repo. What the
measurement decides is no longer whether to replace, but how the replacement is written. Nineteen
sessions, $48.55 total. Shipped 2026-07-28: `runner.ts` passes `--system-prompt` and derived
`--tools`, and every spawnable prompt ends on a shared stopping clause
(`kinds.ts` `DECIDE_AND_STOP`); the durable rules live in `session-kinds.md` §Prompts.

**`--tools` narrowing ships on every spawnable kind, ahead of any prompt change.** It removes 79% of
the fixed overhead, keeps the MCP board tools, and costs nothing in capability as long as the value
list mirrors the kind's own allowlist. Two rules the measurement forces: `Bash` must stay in the
list, because the CLI's read-only classification gives every kind read-only Bash today and every
recorded pass leans on it; and the list is derived from the row's `tools`, never hand-written, so a
preset change cannot silently strip a tool. Helm never passed `--tools`, so this is a new flag on the
`runner.ts` spawn path rather than a change to an existing one.

**Nothing measured argues against replacement anywhere.** The memory gate is clear, no arm lost a
contract item, and every kind with recorded ground truth held or improved: `research` got all three
cases right for a third less draw, `review` returned 11 should-fix findings against the control's 6,
`run` delivered the same story for a third less draw with an identical out-of-band green check, and
`adversary` returned its best yield in the replaced-prose arm. The one arm that looked like a case
against replacement was a case against the draft's shape.

**`adversary` carries the finding that reshapes every draft: the prompt's shape costs more than the
mechanism does.** Four arms, three samples each, all narrowed, so text and mode are the only
variables. The `Tr` arm runs the control's own prose under `--system-prompt`, which makes the
comparison a 2x2 and separates the two candidate causes:

| Arm | Prompt text               | Mode    | Cost/pass | Tool calls | Cache reads | Flags   |
| --- | ------------------------- | ------- | --------- | ---------- | ----------- | ------- |
| T   | control prose             | append  | $2.10     | 29.7       | 1.01M       | 6, 7, 9 |
| Tr  | control prose             | replace | $2.53     | 35.7       | 1.29M       | 8, 9, 9 |
| R2  | skeleton, softened Method | replace | $2.98     | 46.7       | 1.94M       | 8, 8, 7 |
| R   | skeleton                  | replace | $3.07     | 51.3       | 2.14M       | 7, 5, 9 |

The 21.6-call spread between T and R splits unevenly. Holding the mode at `replace`, prose to skeleton
costs 15.6 calls, 72% of it. Holding the text at the control's prose, append to replace costs 6.0
calls, 28%. **The prompt shape drives the overspend, not the loss of the default prompt.** Softening
the draft's `Method` line moved calls only 51.3 to 46.7, because the sentence was never the problem:
a section headed `Method` is read as a procedure to execute, whatever it says. Replacement on its own
is cheap, and it buys the best yield measured. Every `Tr` pass returned at least 8 flags, above every
other arm's mean, for $0.54 less than the skeleton. Anchor accuracy is equal across arms:
spot-checking cited anchors (`runner.ts:113`, `kinds.ts:57`, `markdown.ts:164`, the
`once(child, "close")` claim, the board-service guard) found no false citation on any side.

The default prompt's stopping heuristics remain the plausible cause of the 6-call residual: "When you
have enough information to act, act", "give a recommendation, not an exhaustive survey", and the
terseness framing in its Harness section. A replacement prompt has to supply them for itself. The
shipped configuration confirms it at one sample: the control prose plus the stopping clause under
`--system-prompt` ran 28 calls, $2.01, 9 flags, below the append arm's cost band at the replaced
arm's yield.

Two limits on the yield claim. Flag count is a weak proxy graded at three samples, and the winning
arm's flags were not re-graded individually for false positives. And the sentinel defect (the
first-run-note hash staling) was caught by exactly one pass in three in each of R, T, and Tr, so no
prompt shape makes it reliable; that stays a per-pass lottery, as the tier-1 data already showed.

**The chat kinds stay untested.** `shape`, `define`, `refine`, `init`, and `conflict` have no
recorded ground truth, so their drafts are written and unmeasured. They inherit the `--tools`
narrowing and the prose-shape rule on the same argument as every other kind.

Two limits worth holding. Outside `adversary`, every quality number here is one sample against one
recorded sample, on kinds whose own sweep data shows wide pass-to-pass disjointness. And the `run`,
`research`, and `review` arms moved two levers at once, so their cost win is attributable and their
quality parity is not decomposable.

## Open items found while planning

- Per-repo prompt editing needs a rule for what a repo may override. The shape rules are load-bearing
  on cost: an edit that reintroduces the skeleton silently raises that kind's draw by half again. Open
  question is whether an override replaces the whole prompt or only a kind-specific body composed into
  a fixed frame.
- `propose_scaffold` is missing from `BOARD_TOOLS` in `kinds.ts`, and `init`'s row grants only
  `ask_user`, so the kind cannot propose anything today. `claude-integration.md` §Board tools lists
  the tool as `init`'s output. The init prompt above is untestable until that lands.
- `review` is one registry row but two cold sessions (`review.md` §Two axes), so the row cannot hold
  a single `systemPrompt`. Whatever shape the axes take, the registry needs two prompts.
- The scope-lock overlay in `model-matrix.md` §Fable fallback is scoped to "wherever the fallback
  swaps Fable to Opus", but `run`, `adversary`, `review`, and `research` are Opus in the base
  registry now. The `run` draft above folds the scope constraint in unconditionally, which is a
  decision this experiment does not test. Settle it separately.
