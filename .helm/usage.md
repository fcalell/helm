# Usage ledger

Account draw per story loop, summed from each spawned session's `result` event (fresh input =
`input_tokens` + `cache_creation_input_tokens`). Modeled cost is what the tokens would bill at API
rates; on the Max subscription it is pool draw, not billing. Weighted pool draw approximates the
subscription meter as fresh input + output + 2% of cache reads, split by model tier.

## Harness reference (loop emulation)

How the 001/002 loops were driven before Helm can drive itself; the durable findings live in
`.knowledge/` ([claude-integration](../.knowledge/architecture/claude-integration.md) §Verifying
without burning the pool, [define-refine](../.knowledge/product/features/define-refine.md)
§Refining a story), this list keeps the operational detail:

- One `spawn.sh` per stage mirrors `runner.ts` flags (`-p`, stream-json + verbose + partial
  messages, `--model`/`--effort`/`--permission-mode`/`--allowedTools`/`--strict-mcp-config`,
  optional `--append-system-prompt` file and `--resume`), strips `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `CLAUDECODE`, and `CLAUDE_CODE_ENTRYPOINT` from the environment so the
  spawn bills the subscription, and prints the session id plus the `result` usage line.
- Stream output paths are always absolute: a run's cwd is its worktree, so a relative path lands
  the stream inside the repo and dirties the diff.
- Long spawns run tracked in the background with a watcher loop grepping for the `result` event;
  never detach (`&` + `disown`) inside a tracked task, which orphans the completion signal.
- Stage order per loop: recon, measured-facts brief on the card, cold Opus adversary to NO FLAGS,
  Fable/medium run in the story worktree, cold Sonnet spec + standards reviews, outcome-routed
  fix-up (standards-only resumes the run session on Sonnet/medium; unmet criteria escalate to
  Fable/high), approve exit from the main checkout (never inside the worktree), ledger entry.
- Worktree prep: `pnpm install`, `pnpm generate` (stack virtual modules fail without it), copy
  the gitignored `helm.config.json`.

## 001-01 Session runner & kind registry (2026-07-16 to 2026-07-17)

| Session                        | Model / effort | Fresh input | Output  | Cache reads | Modeled cost |
| ------------------------------ | -------------- | ----------- | ------- | ----------- | ------------ |
| Run 1: implementation          | Fable / high   | 265,633     | 82,332  | 7,393,514   | $16.75       |
| Nested verification spawns (4) | Fable + Sonnet | 50,007      | 929     | 263,452     | $0.90        |
| Review: spec axis              | Sonnet / high  | 59,075      | 14,906  | 427,868     | $0.71        |
| Review: standards axis         | Sonnet / high  | 44,774      | 14,632  | 164,033     | $0.54        |
| Run 2: review fix-up           | Opus / xhigh   | 145,266     | 3,706   | 1,265,714   | $2.17        |
| **Total**                      |                | **564,755** | **116,505** | **9,514,581** | **$21.07** |

The orchestration session that drove the loop is excluded: its usage is not readable from inside
itself.

## 001-02 Board tools: in-process MCP server & proposals (2026-07-17)

| Session                            | Model / effort  | Fresh input | Output      | Cache reads    | Modeled cost |
| ---------------------------------- | --------------- | ----------- | ----------- | -------------- | ------------ |
| Run 1: implementation              | Opus 4.8 / high | 314,758     | 171,390     | 25,054,820     | $19.95       |
| Nested verification spawns (shape) | Fable / high    | 48,229      | 2,158       | 388,285        | $0.73        |
| Review: spec axis                  | Sonnet / high   | 88,373      | 25,948      | 2,749,789      | $1.75        |
| Review: standards axis (2 turns)   | Sonnet / high   | 183,498     | 22,206      | 3,415,474      | $2.46        |
| **Total**                          |                 | **634,858** | **221,702** | **31,608,368** | **$24.89**   |

This loop ran as the 001-02 experiment (Fable plan, Opus build; ledgers in
`usage-experiment-001-02-*.md`), so run 1 and the orchestration are one session: its numbers are
the build-end snapshot, deduped by message id, and the closing loop's own turns after that
snapshot are excluded, same as 001-01's orchestration.

## 001-03 Drawer chat & proposal widgets (2026-07-17)

| Session                              | Model / effort | Fresh input | Output      | Cache reads    | Modeled cost |
| ------------------------------------ | -------------- | ----------- | ----------- | -------------- | ------------ |
| Run 1: implementation                | Fable / medium | 214,872     | 88,188      | 14,191,935     | $22.90       |
| Run 1 browser-verify subagent        | Fable / medium | 126         | 7,624       | 3,184,159      | $3.57        |
| Nested define session (verification) | Fable / medium | 23,957      | 2,812       | 914,051        | $1.53        |
| Review: spec axis                    | Sonnet / high  | 42,319      | 11,911      | 552,509        | $0.60        |
| Review: standards axis               | Sonnet / high  | 44,298      | 20,132      | 420,201        | $0.69        |
| Run 1 follow-up: review fix-up       | Fable / xhigh  | 207,702     | 2,494       | 682,516        | $4.96        |
| **Total**                            |                | **533,274** | **133,161** | **19,945,371** | **$34.25**   |

The first run at the medium default. The browser-verify subagent is the run's in-browser check,
recorded in its own transcript under the session's `subagents/` directory (a blind spot in the
first cut of this table); the nested define session is the live target its widget checks drove.
The follow-up resumed the same session at xhigh, so its fresh input is the full transcript
re-entering cache: the effort switch changes the request shape, which forfeits the warm prefix.

## 001-04 Shape & define chats (2026-07-17)

| Session                                  | Model / effort  | Fresh input | Output      | Cache reads    | Modeled cost |
| ---------------------------------------- | --------------- | ----------- | ----------- | -------------- | ------------ |
| Run 1: implementation                    | Fable / medium  | 274,363     | 115,925     | 26,950,539     | $34.23       |
| Run 1 browser-verify subagent            | Fable / medium  | 43,493      | 11,288      | 631,361        | $2.07        |
| Nested verification sessions (4, scratch repo) | Fable / medium | 58,708 | 3,892       | 626,835        | $2.00        |
| Review: spec axis                        | Sonnet / high   | 62,808      | 18,109      | 970,954        | $0.94        |
| Review: standards axis                   | Sonnet / high   | 82,175      | 26,541      | 1,571,651      | $1.36        |
| Run 1 follow-up: review fix-up           | Sonnet / medium | 87,972      | 12,136      | 2,006,521      | $1.31        |
| **Total**                                |                 | **609,519** | **187,891** | **32,757,861** | **$41.91**   |

First data point for the outcome-routed follow-up: the standards-only round resumed on Sonnet at
medium and cost $1.31 against 001-03's $4.96 at a Fable escalation, with the same cache reseed in
the price. The nested rows are the run's live verification targets, four shape/define sessions
spawned on the scratch repo plus the in-browser subagent check.

## 001-05 Refine chat (2026-07-17)

| Session                                        | Model / effort  | Fresh input | Output      | Cache reads    | Modeled cost |
| ---------------------------------------------- | --------------- | ----------- | ----------- | -------------- | ------------ |
| Run 1: implementation                          | Fable / medium  | 203,493     | 70,068      | 17,317,676     | $24.89       |
| Nested verification sessions (2, scratch repo) | Fable / medium  | 58,970      | 7,039       | 767,242        | $2.30        |
| Review: spec axis                              | Sonnet / high   | 61,231      | 25,513      | 1,743,128      | $1.27        |
| Review: standards axis                         | Sonnet / high   | 46,020      | 19,676      | 209,216        | $0.64        |
| Run 1 follow-up: review fix-up                 | Sonnet / medium | 53,180      | 7,763       | 1,482,255      | $1.51        |
| **Total**                                      |                 | **422,894** | **130,059** | **21,519,517** | **$30.61**   |

The cheapest full loop so far, and the fastest run (24 minutes against 001-04's 44): most of the
refine backend already existed from 001-04, so the run spent its tokens on the seams. The nested
rows are the run's live targets, a fresh refine session driven through the whole
propose-accept-resolve flow and the reseeded session that proved the stale path; no browser
subagent ran, so the artifact pane and the ⚠ marker rest on code-level review plus by-hand steps
in the run report. The standards-only follow-up on Sonnet at medium repeats 001-04's data point:
$1.51 for a ten-finding cosmetic round.

## 001-06 Ready gate: dispatcher & adversary review (2026-07-17)

| Session                                         | Model / effort   | Fresh input | Output      | Cache reads    | Modeled cost |
| ----------------------------------------------- | ---------------- | ----------- | ----------- | -------------- | ------------ |
| Run 1: implementation                           | Fable / medium   | 275,035     | 126,790     | 31,780,737     | $43.62       |
| Nested verification sessions (12, scratch repo) | Fable / med–high | 149,006     | 29,331      | 1,428,438      | $5.87        |
| Review: spec axis                               | Sonnet / high    | 63,373      | 27,667      | 454,401        | $0.93        |
| Review: standards axis                          | Sonnet / high    | 75,772      | 26,830      | 672,965        | $1.06        |
| Run 1 follow-up: review fix-up                  | Sonnet / medium  | 50,952      | 13,211      | 782,011        | $1.54        |
| **Total**                                       |                  | **614,138** | **223,829** | **35,118,552** | **$53.02**   |

The most expensive loop so far, and the first whose live verification itself spawns real cold
sessions: the twelve nested rows are the scratch repo's adversary passes (Fable at high per the
kind registry) and the steered refine sessions that drove the fix, contest, unanswered, and
dismissal paths for real, so the gate's whole round machinery is exercised rather than mocked.
The run also ran the longest (45 minutes, 185 turns) against the milestone's widest blast radius
(26 files across every src/ module). Spec review graded 11/11 with zero unclear; the standards
round's two blockers split on adjudication — the attempt-leak fix landed, while the suggested
`review/blocked → ready` reopening was rejected as a gate bypass and reduced to a message reword.
The Sonnet-medium follow-up held the cosmetic-round price at $1.54 for a ten-item payload.

## 002-01 Run kind & worktree lifecycle (2026-07-17 to 2026-07-18)

| Session                                    | Model / effort  | Fresh input   | Output      | Cache reads    | Modeled cost |
| ------------------------------------------ | --------------- | ------------- | ----------- | -------------- | ------------ |
| Refine chat (app-driven)                   | Fable / medium  | 879,336       | 213,164     | 15,370,681     | $43.62       |
| Adversary passes (15, cold)                | Fable / high    | 1,240,588     | 345,786     | 10,435,562     | $52.54       |
| Run 1: implementation                      | Fable / medium  | 217,668       | 94,158      | 13,053,355     | $22.11       |
| Nested verification runs (4, scratch repo) | Fable / medium  | 28,552        | 2,747       | 486,477        | $1.19        |
| Review: spec axis                          | Sonnet / high   | 79,679        | 18,548      | 1,594,823      | $1.23        |
| Review: standards axis                     | Sonnet / high   | 58,277        | 27,337      | 431,884        | $0.89        |
| Run 1 follow-up: review fix-up             | Sonnet / medium | 66,756        | 11,146      | 978,210        | $0.86        |
| **Total**                                  |                 | **2,570,856** | **712,886** | **42,350,992** | **$122.44**  |

The first loop whose refinement ran through Helm itself, and the first ledger that can price it:
epic 1 refined inside the orchestration session, whose draw is excluded as unreadable, so the two
new rows surface a cost that always existed off the books. They dominate the loop at $96 against
the run's $22: the refine chat answered eleven gate rounds on top of building the brief, and the
gate spawned fifteen cold Fable-high passes (eleven flag rounds across a server restart, one
verdict discarded on a mid-flight edit, one clean pass, two lost to the restart) that accepted 22
brief fixes and recorded two overrides. The build side stayed cheap: the run finished in 23
minutes and 144 turns with all ten criteria verified live against a scratch repo, the four nested
rows are its tiny Auto runs driving the review, blocked, kill, and reconciliation paths, and the
standards-only follow-up held the Sonnet-medium price at $0.86 for a ten-item payload.

## 002-02 Permission presets & needs-input (2026-07-20)

| Session                              | Model / effort  | Fresh input   | Output      | Cache reads    | Modeled cost |
| ------------------------------------ | --------------- | ------------- | ----------- | -------------- | ------------ |
| Adversary passes (12: 1 warm + 11 cold) | Opus / high  | 1,202,108     | 346,746     | 6,412,018      | $23.95       |
| Run 1: implementation                | Fable / medium  | 289,720       | 106,674     | 33,411,977     | $44.54       |
| Review: spec axis                    | Sonnet / high   | 62,577        | 12,225      | 1,450,595      | $1.00        |
| Review: standards axis               | Sonnet / high   | 88,013        | 26,529      | 4,406,785      | $2.25        |
| Run 1 follow-up: review fix-up       | Sonnet / medium | 238,877       | 1,085       | 1,337,596      | $1.85        |
| **Total**                            |                 | **1,881,295** | **493,259** | **47,018,971** | **$73.59**   |

The first Opus gate end-to-end (the matrix's experiment 2) and the first warm-middle attempt:
refinement ran inside the orchestration session (excluded as unreadable, the epic-1 pattern), so
the gate line is the adversary alone. Twelve passes to a clean cold verdict against 002-01's
fifteen at Fable, at ~$2 per pass against ~$3.50, cutting the adversary line $52.54 → $23.95 with
twelve real flaws fixed and zero dismissals; the warm resume verified fixes for $1.12 against a
~$2 cold read, but the sign-off chain stayed cold by design, so warm-the-middle saved only the one
iterative round this gate happened to have. The run implemented all six brief surfaces in 32
minutes with eight of ten criteria verified live against the real orchestrator on a scratch repo
(the two UI-interaction checks stay by-hand), and its spike settled the held-approval question:
no server-side ceiling exists, so the planned stack timeout work was never needed. The
standards-only follow-up's $1.85 is almost entirely the Sonnet tier-switch reseeding the run's
239k-token transcript, the priced-in cost session-kinds.md records for outcome-routed follow-ups.

## 002-03 Activity timeline & steering (2026-07-20)

| Session                          | Model / effort  | Fresh input | Output      | Cache reads    | Modeled cost |
| -------------------------------- | --------------- | ----------- | ----------- | -------------- | ------------ |
| Adversary passes (4, all cold)   | Opus / high     | 357,377     | 105,150     | 1,932,890      | $7.17        |
| Run 1: implementation            | Fable / medium  | 209,367     | 76,176      | 13,257,893     | $21.23       |
| Review: spec axis                | Sonnet / high   | 60,344      | 17,001      | 1,263,975      | $1.00        |
| Review: standards axis           | Sonnet / high   | 55,008      | 19,645      | 1,118,535      | $0.96        |
| Run 1 follow-up: review fix-up   | Sonnet / medium | 170,210     | 4,637       | 1,731,591      | $1.61        |
| **Total**                        |                 | **852,306** | **222,609** | **19,304,884** | **$31.97**   |

The first loop sized to the story-sizing lever: a single-surface ~10.5KB brief (a third of
002-02's) converged in four all-cold Opus passes against twelve, five real flaws fixed, zero
dismissals, and the gate line fell $23.95 → $7.17 at the same ~$1.8 per pass. Refinement again ran
inside the orchestration session (excluded as unreadable). The all-cold protocol follows the
002-02 finding that a warm middle re-enters its transcript as fresh writes without cutting passes.
The run delivered in 19 minutes with six of ten criteria verified live against the orchestrator on
a scratch repo, and its one measured deviation improved the spec: CLI 2.1.215 flushes a
result/error_during_execution frame on SIGTERM (the old no-result note was stale), so only a clean
completion overrides a kill intent; recorded in claude-integration.md §Hooks. The comments-only
follow-up repeated the tier-switch price pattern: $1.61, almost all reseeding the run's 170k
transcript at Sonnet's write rate. Loop total $31.97 against 002-02's $73.59 and 002-01's $122.44.
Weighted pool draw (fresh + output + 2% of cache reads, the est calibration): Fable ~551k against
002-02's ~1.06M; Opus/Sonnet ~910k against ~2.79M.

## 002-04 Run queue & rate-limit meter (2026-07-20)

| Session                          | Model / effort  | Fresh input   | Output      | Cache reads    | Modeled cost |
| -------------------------------- | --------------- | ------------- | ----------- | -------------- | ------------ |
| Adversary passes (3, all cold)   | Opus / high     | 329,645       | 82,512      | 1,695,867      | $6.21        |
| Run 1: implementation            | Fable / medium  | 245,569       | 82,675      | 19,164,043     | $28.20       |
| Review: spec axis                | Sonnet / high   | 91,192        | 42,075      | 3,064,550      | $2.10        |
| Review: standards axis           | Sonnet / high   | 90,761        | 32,131      | 3,184,831      | $1.98        |
| Run 1 follow-up: race fix-up     | Fable / high    | 246,729       | 12,198      | 3,637,849      | $9.18        |
| **Total**                        |                 | **1,003,896** | **251,591** | **30,747,140** | **$47.67**   |

Second loop on the sized-slice lever: a ~11KB single-story brief converged in three all-cold Opus
passes (four on 002-03, twelve on the 002-02 monolith) at the same ~$2 per pass; the gate line fell
again, $7.17 to $6.21, with seven real spec flaws fixed across two rounds and zero dismissals. The
run was this epic's heaviest so far ($28.20, 19.2M cache reads over 21 minutes): the brief spans
dispatcher, runs service, meter service, channel, and header, and the run verified eight of ten
criteria live against a scratch orchestrator, including the front-enqueued steer beating waiting
fresh starts and the nested rate_limit_info parse. Both cold reviews independently converged on
the same real enqueue-time RUN_ACTIVE race the run's report had claimed closed, which validates
the two-axis review shape; the payload graded as an unmet-criterion letter, so the follow-up
routed to Fable at high per the outcome tiers, and its price shows the escalation cost the routing
rule prices in: $9.18, of which ~247k fresh input is the 21-minute transcript reseeding at Fable's
write rate on the effort switch (against $1.61 for 002-03's Sonnet-medium cosmetic round). The fix
was race-verified live with concurrent double-calls. Loop total $47.67 against 002-03's $31.97,
002-02's $73.59, and 002-01's $122.44; the delta over 002-03 is the run's genuine size plus the
high-tier follow-up, not gate drift. Weighted pool draw (fresh + output + 2% of cache reads, held
as bounds per the failed alpha re-fit): Fable ~1.04M; Opus/Sonnet ~827k. The orchestration session
(Fable) again ran refinement inline and stays unledgered.


## 002-05 Run compaction (2026-07-21)

| Session                          | Model / effort  | Fresh input   | Output      | Cache reads    | Modeled cost |
| -------------------------------- | --------------- | ------------- | ----------- | -------------- | ------------ |
| Compaction probes (3, refine)    | Sonnet / low    | ~210,000      | ~3,000      | ~700,000       | ~$2.40       |
| Adversary pass (1, cold)         | Opus / high     | 79,966        | 23,777      | 451,963        | $1.62        |
| Run 1: implementation (3 segs)   | Fable / medium  | 927,799       | 90,054      | 21,179,867     | ~$44.23      |
| Review: spec axis                | Sonnet / high   | 49,046        | 12,790      | 1,981,592      | $1.09        |
| Review: standards axis           | Sonnet / high   | 46,797        | 14,610      | 1,843,309      | $1.05        |
| Run 1 follow-up: doc/copy fixes  | Sonnet / medium | 175,226       | 4,200       | 3,368,513      | $2.12        |
| **Total**                        |                 | **~1,488,834**| **~148,431**| **~29,525,244**| **~$52.51**  |

Two tildes carry the estimates: the probe streams and segment 2's result frame were lost to a
session wipe, so probes 2-3 are sized from probe 1's measured $1.29 and segment 2 is
transcript-derived at Fable's fitted rates ($10/M base, 2x 1h-cache writes, 5x output, 0.1x
reads; segments 1 and 3 fit those rates exactly). The gate converged in a single cold Opus pass,
a new record (three on 002-04, four on 002-03, twelve on 002-02): refine spent ~$2.40 measuring
the CLI's actual compaction behavior first (auto-compact fires mid-turn under a shrunken
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, settings-file disable honored, system prompt re-read on
resume), and a brief whose Approach opens with verbatim measured frames left the adversary
nothing structural to attack. The run's ~$44.23 carries ~$18.7 of pure loop-harness waste:
segment 1 ended its turn to "wait" for background watchers (headless turn end kills the process),
and the steered segment 2 then died on the 5-hour rate-limit window mid-probe, the first time the
loop itself hit the pool it meters. Both cold reviews found zero code defects, a first; the whole
payload was three adjacent-doc drift items plus three copy/comment nits, so the follow-up routed
to Sonnet at medium per the outcome tiers: $2.12, the routing lever's third point ($1.61 on
002-03's cosmetic round, $9.18 on 002-04's Fable-high escalation). The run also surfaced an
unrecorded CLI guard worth a knowledge note next touch: auto-compact errors out when context
refills within three turns of a compact three times running ("thrashing"), and the close path
already parks that Blocked. Loop total ~$52.51 against 002-04's $47.67, 002-03's $31.97,
002-02's $73.59, 002-01's $122.44; the delta over 002-04 is entirely the harness waste, not the
story. Weighted pool draw (fresh + output + 2% of cache reads): Fable ~1.44M; Opus/Sonnet ~786k.
The orchestration session (Fable) again ran refinement and the probes inline and stays
unledgered.

## 002-06 Review: rebase, diff & checklist (2026-07-20 to 2026-07-21)

| Session                          | Model / effort  | Fresh input   | Output      | Cache reads    | Modeled cost |
| -------------------------------- | --------------- | ------------- | ----------- | -------------- | ------------ |
| Adversary pass (1, cold)         | Opus / high     | 53,081        | 14,924      | 676,686        | $1.24        |
| Run 1: implementation (1 seg)    | Fable / medium  | 165,336       | 62,796      | 9,379,194      | $15.83       |
| Review: spec axis                | Sonnet / high   | 81,469        | 27,137      | 3,807,749      | $2.04        |
| Review: standards axis (2 turns) | Sonnet / high   | 59,568        | 16,304      | 2,398,596      | $1.32        |
| Run 1 follow-up: standards trio  | Sonnet / medium | 168,148       | 4,386       | 1,980,505      | $1.67        |
| **Total**                        |                 | **527,602**   | **125,547** | **18,242,730** | **$22.10**   |

The cheapest full loop yet ($22.10 against 002-05's ~$52.51, 002-04's $47.67, 002-03's $31.97),
and the cleanest: the gate again converged in one cold Opus pass (the second single-pass gate
running, both on measured-facts-first briefs), the run needed no steering and finished in one
14.6-minute segment despite shipping 671 lines across 13 files, verifying eight of ten criteria
live against a scratch orchestrator with three real headless runs. The spec review graded 10/10
with zero free-form defects; the standards payload was one UI filter (verification block showed
every run note, not just `verify:` bullets) plus two doc rewraps, so the follow-up routed to
Sonnet at medium: $1.67, the routing lever's fourth point. One harness wrinkle: the standards
session emitted `VERDICT: findings` with the findings stranded in its reasoning, and a $0.03
resume recovered them; the review prompt should demand findings and verdict in the same message.
Weighted pool draw (fresh + output + 2% of cache reads): Fable ~416k; Opus/Sonnet ~602k.
The orchestration session (Fable) ran refinement inline and stays unledgered.

## 002-07 Review exits (2026-07-21)

| Session                          | Model / effort  | Fresh input   | Output      | Cache reads    | Modeled cost |
| -------------------------------- | --------------- | ------------- | ----------- | -------------- | ------------ |
| Adversary pass (1, cold)         | Opus / high     | 61,932        | 19,398      | 705,193        | $1.46        |
| Run 1: implementation (1 seg)    | Fable / medium  | 186,277       | 57,293      | 10,705,509     | $17.29       |
| Review: spec axis                | Sonnet / high   | 79,298        | 25,773      | 4,450,300      | $2.20        |
| Review: standards axis           | Sonnet / high   | 44,471        | 12,919      | 1,112,659      | $0.80        |
| Run 1 follow-up: standards pair  | Sonnet / medium | 173,919       | 1,844       | 1,383,986      | $1.49        |
| **Total**                        |                 | **545,897**   | **117,227** | **18,357,647** | **$23.24**   |

Third single-pass gate running, and the second loop in a row with a steering-free single-segment
run: the story shipped the three review exits (696 lines, 13 files) in 13.7 minutes, verifying
eleven of twelve criteria live by pointing a scratch orchestrator at a stub `claude` that logs
its argv and replays real stream-json frames, so full spawn/close cycles cost no pool tokens, a
harness trick worth reusing. The spec review graded 12/12 with zero free-form defects; the
standards payload was two items (an errorText duplicate that dropped truncation, one redundant
comment), routed to Sonnet at medium for $1.49. The findings-and-verdict-in-one-message prompt
fix (after 002-06's stranded-findings wrinkle) held: the standards review returned both
together. Loop total $23.24; the 002-06/002-07 pair together cost $45.34, less than 002-05
alone (~$52.51). Weighted pool draw (fresh + output + 2% of cache reads): Fable ~458k;
Opus/Sonnet ~573k. The orchestration session (Fable) ran refinement inline and stays unledgered.

## 002-08 UI actions & hotkey removal (2026-07-21)

| Session                          | Model / effort  | Fresh input   | Output      | Cache reads    | Modeled cost |
| -------------------------------- | --------------- | ------------- | ----------- | -------------- | ------------ |
| Adversary pass (1, cold)         | Opus / high     | 37,370        | 7,981       | 356,102        | $0.75        |
| Run 1: implementation (1 seg)    | Fable / medium  | 151,932       | 57,644      | 9,271,858      | $15.19       |
| Review: spec axis                | Sonnet / high   | 38,159        | 7,700       | 1,211,053      | $0.71        |
| Review: standards axis           | Sonnet / medium | 27,501        | 2,761       | 632,911        | $0.40        |
| **Total**                        |                 | **254,962**   | **76,086**  | **11,471,924** | **$17.05**   |

Fourth single-pass gate in a row and the first loop with no fix-up segment at all: the spec
review graded 10/10 with zero free-form defects and the standards review returned clean, so the
run's single 20.7-minute segment was the only Fable spend. The run raised the verification bar
again: it drove a real headless Chromium (playwright-core) against a live orchestrator on a
scratch repo, asserting on DOM state and intercepted RPC traffic, 26 checks passing, while
deliberately skipping clicks that would spawn real `claude` sessions. The diff itself is net
negative (+122/-124 across 7 files): the hotkey layer and selection machinery deleted, the
status-driven card actions (Refine / Chat / Run) and header buttons added, closing the gap where
`run.start` had no UI caller. The run also surfaced a pre-existing production-build blank-page
bug (dev server fine, `stack build` output mounts nothing), left for its own story. Loop total
$17.05, the cheapest yet. Weighted pool draw (fresh + output + 2% of cache reads): Fable ~395k;
Opus/Sonnet ~166k. The orchestration session (Fable) ran refinement inline and stays unledgered.
