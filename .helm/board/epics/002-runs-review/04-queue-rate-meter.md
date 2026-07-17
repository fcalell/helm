---
id: 002-04
status: backlog
depends: [002-01]
branch: helm/002-04-queue-rate-meter
sessions: {}
---
# Run queue & rate-limit meter

## Goal

Runs dispatch through the serial dispatcher 001-06 built (concurrency cap 1; chat kinds keep
bypassing it), and the board header's placeholders become the live rate-limit meter and queue
occupancy fed by the `rate_limit_event` every session emits
(`.knowledge/product/features/runs.md` §Queue & rate limits). Auto-pause on limit errors is v2
with parallel runs; v1 shows the meter and the reset clock.
