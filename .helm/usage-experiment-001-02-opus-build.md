# Usage: experiment 001-02 build session (Opus 4.8, high effort, 1M context)

Token draw of the single session that implemented `.helm/experiment-001-02-plan.md` against the
001-02 brief. Modeled cost uses the Opus 4.8 API rates below; on the Max subscription it is pool
draw, not billing. This is a snapshot taken while the session was still open, so it excludes the
last few messages (this ledger write and the final report).

Transcript: `~/.claude/projects/-home-fcalell-projects-helm/609e1632-d1c1-4145-99e8-d2fcdb266ca4.jsonl`.
The task expected it under the worktree slug (`-home-fcalell-projects-helm-wt-001-02/`), but that
directory holds no transcripts: like the Window 1 planning session, this session was started from
the main checkout, so its transcript lives under the main cwd slug. The session id is confirmed by
the scratchpad path, which embeds `609e1632-d1c1-4145-99e8-d2fcdb266ca4`.

Rates: input $5/MTok · cache write 1h $10/MTok · cache write 5m $6.25/MTok · cache read $0.50/MTok
· output $25/MTok. All cache writes this session were 1h ephemeral (the session's prompt-cache TTL).

## Method: dedupe by message id

Claude Code logs each streamed assistant message several times as it arrives, every line carrying
the same cumulative `message.usage`. This transcript has 122 unique assistant messages logged as
390 `assistant`-type entries; per-message usage is byte-identical across the repeats. Summing every
entry (the literal reading of "sum across every assistant-type entry", which the Window 1 ledger
used) therefore multiplies the real draw by about 3.2x. The table below counts each message once;
the raw-sum table follows for comparison with the Window 1 fable-plan ledger, which did not dedupe.

## True usage (each message counted once)

| Bucket           | Tokens         | Rate / MTok | Modeled cost |
| ---------------- | -------------- | ----------- | ------------ |
| Input (uncached) | 1,367          | $5          | $0.01        |
| Cache write (1h) | 313,391        | $10         | $3.13        |
| Cache write (5m) | 0              | $6.25       | $0.00        |
| Cache read       | 25,054,820     | $0.50       | $12.53       |
| Output           | 171,390        | $25         | $4.28        |
| **Total**        | **25,540,968** |             | **$19.95**   |

Fresh input (`input_tokens` + all cache writes, the ledger's convention): 314,758.

## Raw sum (every assistant entry, Window 1 method)

Reported for like-for-like comparison with `.helm/usage-experiment-001-02-fable-plan.md`, which
summed raw. This inflates every bucket by the per-message repeat count and is not real token draw.

| Bucket           | Tokens         | Rate / MTok | Modeled cost |
| ---------------- | -------------- | ----------- | ------------ |
| Input (uncached) | 6,288          | $5          | $0.03        |
| Cache write (1h) | 991,805        | $10         | $9.92        |
| Cache write (5m) | 0              | $6.25       | $0.00        |
| Cache read       | 65,384,037     | $0.50       | $32.69       |
| Output           | 548,356        | $25         | $13.71       |
| **Total**        | **66,930,486** |             | **$56.35**   |

Fresh input (raw): 998,093.

The claude sessions this build spawned to verify acceptance criteria (four `shape` runs plus their
resumes) are separate processes with their own transcripts and are not counted here.
