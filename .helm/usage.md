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
