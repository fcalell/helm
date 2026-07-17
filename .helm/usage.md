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
| Nested define session (verification) | Fable / medium | 23,957      | 2,812       | 914,051        | $1.53        |
| Review: spec axis                    | Sonnet / high  | 42,319      | 11,911      | 552,509        | $0.60        |
| Review: standards axis               | Sonnet / high  | 44,298      | 20,132      | 420,201        | $0.69        |
| Run 1 follow-up: review fix-up       | Fable / xhigh  | 207,702     | 2,494       | 682,516        | $4.96        |
| **Total**                            |                | **533,148** | **125,537** | **16,761,212** | **$30.68**   |

The first run at the medium default: run 1 includes its in-browser verification sidechain, and the
nested define session is the live target its widget checks drove. The follow-up resumed the same
session at xhigh, so its fresh input is mostly the transcript re-entering cache.
