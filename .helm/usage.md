# Usage ledger

Account draw per story loop, summed from each spawned session's `result` event (fresh input =
`input_tokens` + `cache_creation_input_tokens`). Modeled cost is what the tokens would bill at API
rates; on the Max subscription it is pool draw, not billing.

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
