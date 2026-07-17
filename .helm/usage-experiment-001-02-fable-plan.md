# Usage: experiment 001-02 planning session (Fable 5, high effort)

Token draw of the single session that produced `.helm/experiment-001-02-plan.md`, summed across
all 79 `assistant`-entry `message.usage` blocks of its own transcript
(`~/.claude/projects/-home-fcalell-projects-helm/9bda1eb9-147b-41b2-ad6e-0dd13b2eddb8.jsonl`; the
session was started from the main checkout, so its transcript lives under that cwd slug, not the
worktree's). Modeled cost uses the Fable 5 API rates below; on the Max subscription it is pool
draw, not billing.

Rates: input $10/MTok · cache write 1h $20/MTok · cache write 5m $12.50/MTok · cache read $1/MTok
· output $50/MTok.

| Bucket               | Tokens        | Rate / MTok | Modeled cost |
| -------------------- | ------------- | ----------- | ------------ |
| Input (uncached)     | 142           | $10         | $0.00        |
| Cache write (1h)     | 399,805       | $20         | $8.00        |
| Cache write (5m)     | 0             | $12.50      | $0.00        |
| Cache read           | 6,562,487     | $1          | $6.56        |
| Output               | 171,010       | $50         | $8.55        |
| **Total**            | **7,133,444** |             | **$23.11**   |

Fresh input (`input_tokens` + all cache writes, the ledger's convention): 399,947.
