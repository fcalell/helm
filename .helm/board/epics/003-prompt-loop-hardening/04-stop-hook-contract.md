---
id: 003-04
status: backlog
depends: []
sessions: {}
---
# Stop-hook close contract

## Goal

The run's Stop hook blocks a stop whose closing contract is unmet, with feedback naming what is
missing: no closing `update_card` note this segment, or a dirty worktree. The refusal is bounded
at three like PreCompact, so a wedged run can still end. "Forgot to write closing notes" stops
being a failure mode; the prompt keeps the contract statement and loses the exhortation weight.
